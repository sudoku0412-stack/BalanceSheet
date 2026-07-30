import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { v4 as uuidv4 } from 'uuid';
import {
  saveReceipt,
  saveCorrection,
  getRelevantCorrections,
  getGeminiCachedResponse,
  setGeminiCachedResponse,
} from '../../lib/database';
import { parseReceiptText, parseYmdLocal } from '../../lib/parser';
import { persistReceiptImage } from '../../lib/receiptPhoto';
import { notifySuccess } from '../../lib/haptics';
import {
  parseReceiptWithGemini,
  parseGeminiPayload,
} from '../../lib/geminiParseReceipt';
import { parseReceiptWithCloudflare } from '../../lib/cloudflareReceiptParse';
import { getGeminiApiKey } from '../../lib/secureStorage';
import { ParsedReceipt, Category, LineItem } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES } from '../../constants/categories';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CategoryTagsPicker } from '../../components/ui/CategoryTagsPicker';
import { TagChip } from '../../components/ui/TagChip';
import { ItemEditModal } from '../../components/receipt/ItemEditModal';
import { checkItemsAgainstSubtotal } from '../../lib/itemsTotalCheck';

type ScanState = 'idle' | 'processing' | 'review';

/**
 * Pick the receipt-level category that best represents this set of
 * line items: the category whose total spend across the items is
 * largest. Returns null on an empty list.
 */
function pickDominantCategory(items: LineItem[]): Category | null {
  if (!items.length) return null;
  // Only consider standard categories for picking the receipt's primary
  // category — custom tags don't belong in the strict Category enum.
  const standardSet = new Set<string>(ALL_CATEGORIES);
  const spend: Partial<Record<Category, number>> = {};
  for (const item of items) {
    const raw = (item.category ?? 'Other') as string;
    const c = (standardSet.has(raw) ? raw : 'Other') as Category;
    spend[c] = (spend[c] ?? 0) + Math.abs(item.amount);
  }
  let best: Category = 'Other';
  let bestSpend = -1;
  for (const [cat, amt] of Object.entries(spend) as [Category, number][]) {
    if (amt > bestSpend) {
      best = cat;
      bestSpend = amt;
    }
  }
  return best;
}

function uniqueItemCategories(items: LineItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.category) set.add(item.category);
  }
  return Array.from(set);
}

export default function ScanScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useStyles((t) => ({
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
    },

    // ─── Idle (camera capture) ──────────────────────────────────────
    cameraScreen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    viewfinder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: t.spacing.xl,
    },
    viewfinderWatermark: {
      position: 'absolute',
      opacity: t.isDark ? 0.14 : 0.08,
    },
    frameGuide: {
      width: '78%',
      aspectRatio: 0.72,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: 'rgba(255,255,255,0.55)',
      borderRadius: t.radius.xl,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.spacing.lg,
    },
    frameGuideText: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: t.font.sm,
      fontWeight: '600',
      textAlign: 'center',
    },
    cameraControls: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.xl,
      paddingBottom: t.spacing.xxl,
      paddingTop: t.spacing.lg,
    },
    cameraSideBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterRing: {
      width: 80,
      height: 80,
      borderRadius: 40,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterFill: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: '#fff',
    },

    // ─── Processing ─────────────────────────────────────────────────
    processingImage: {
      width: '100%',
      height: 260,
      opacity: 0.35,
    },
    processingOverlay: {
      position: 'absolute',
      alignItems: 'center',
      gap: 12,
      backgroundColor: t.colors.surface,
      paddingVertical: t.spacing.lg,
      paddingHorizontal: t.spacing.xl,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    processingText: {
      color: t.colors.textPrimary,
      fontSize: t.font.xl,
      fontWeight: '700',
    },
    processingSubText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
    },

    // ─── Review ─────────────────────────────────────────────────────
    reviewContent: {
      padding: t.spacing.md,
      gap: t.spacing.sm,
      paddingBottom: 40,
    },
    receiptThumb: {
      width: '100%',
      height: 180,
      borderRadius: t.radius.lg,
      marginBottom: t.spacing.sm,
    },
    reviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      marginBottom: t.spacing.xs,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reviewTitle: {
      color: t.colors.textPrimary,
      fontSize: t.font.lg,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 1.2,
    },
    statusRow: {
      marginBottom: t.spacing.xs,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: t.radius.full,
      borderWidth: 1,
      maxWidth: '100%',
    },
    statusBadgePending: {
      backgroundColor: t.colors.primaryFaint,
      borderColor: 'transparent',
    },
    statusBadgeSuccess: {
      backgroundColor: `${t.colors.success}22`,
      borderColor: t.colors.success,
    },
    statusBadgeWarning: {
      backgroundColor: `${t.colors.warning}22`,
      borderColor: `${t.colors.warning}55`,
    },
    statusBadgeNeutral: {
      backgroundColor: t.colors.surface,
      borderColor: t.colors.border,
    },
    statusText: {
      fontSize: t.font.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      flexShrink: 1,
    },
    fieldCard: {
      gap: t.spacing.sm,
    },
    fieldLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    input: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    inputMultiline: {
      minHeight: 72,
      paddingTop: 10,
    },
    itemsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    itemsHint: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
    },
    lineItemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderRadius: t.radius.md,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    lineItemRowPressed: {
      backgroundColor: t.colors.surfaceHigh,
    },
    lineItemName: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      flex: 1,
      marginRight: 4,
    },
    lineItemAmount: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '600',
      minWidth: 56,
      textAlign: 'right',
    },
    moreItemsBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      marginTop: 8,
      paddingVertical: 8,
    },
    moreItemsText: {
      color: t.colors.primary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    addItemBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 10,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: t.radius.full,
      borderStyle: 'dashed',
    },
    addItemBtnText: {
      color: t.colors.primary,
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    saveBtn: {
      marginTop: t.spacing.md,
    },
    discardLink: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: t.spacing.sm,
    },
    discardLinkText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
  }));
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable fields in review state
  const [storeName, setStoreName] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [tax, setTax] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [categoryTags, setCategoryTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [showAllItems, setShowAllItems] = useState(false);
  const [editingItem, setEditingItem] = useState<LineItem | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  // Snapshot of the items returned by the parser pipeline (regex or
  // AI). Used at save-time to detect whether the user manually
  // corrected anything — if so we stash the OCR + final items so
  // future scans of the same store get them as in-context examples.
  const [parserBaseline, setParserBaseline] = useState<LineItem[]>([]);
  const [aiPending, setAiPending] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);
  const [aiError, setAiError] = useState<{
    kind: import('../../lib/geminiParseReceipt').GeminiErrorKind;
    message: string;
  } | null>(null);
  const [rawText, setRawText] = useState('');

  const runOCR = async (uri: string) => {
    setScanState('processing');
    try {
      // @react-native-ml-kit/text-recognition (replacement for the
      // unmaintained react-native-text-recognition) returns a structured
      // result with blocks → lines → text. Flatten to a string-array of
      // lines so the existing parser keeps working unchanged.
      const ocr = await TextRecognition.recognize(uri);
      const lines: string[] = ocr.blocks.flatMap((block) =>
        block.lines.map((line) => line.text),
      );
      const rawText = lines.join('\n');
      const result = parseReceiptText(rawText);

      setParsed(result);
      setRawText(rawText);
      setStoreName(result.storeName);
      setDate(format(new Date(result.date), 'yyyy-MM-dd'));
      setAmount(result.totalAmount > 0 ? result.totalAmount.toFixed(2) : '');
      setSubtotal(result.subtotalAmount != null ? result.subtotalAmount.toFixed(2) : '');
      setTax(result.taxAmount != null ? result.taxAmount.toFixed(2) : '');
      setCategory(result.category);
      setCategoryTags(result.categoryTags ?? [result.category]);
      setItems(result.lineItems);
      setParserBaseline(result.lineItems);
      setAiApplied(false);
      setAiError(null);
      setScanState('review');

      // Fire AI parse in parallel. The user sees the regex result
      // immediately; when Gemini returns we replace the state in-place
      // because Gemini is dramatically more accurate than the regex
      // for messy phone-camera OCR.
      runAiParse(rawText);
    } catch (err) {
      Alert.alert(
        'OCR Failed',
        'Could not read the receipt. Please enter the details manually.',
        [{ text: 'OK' }],
      );
      setParsed({ storeName: '', date: new Date().toISOString(), totalAmount: 0, category: 'Other', lineItems: [], rawText: '' });
      setStoreName('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setAmount('');
      setSubtotal('');
      setTax('');
      setCategory('Other');
      setItems([]);
      setScanState('review');
    }
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to scan receipts.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      await runOCR(result.assets[0].uri);
    }
  };

  const startManualEntry = () => {
    setImageUri(null);
    setParsed({
      storeName: '',
      date: new Date().toISOString(),
      totalAmount: 0,
      category: 'Other',
      lineItems: [],
      rawText: '',
    });
    setStoreName('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setAmount('');
    setSubtotal('');
    setTax('');
    setCategory('Other');
    setCategoryTags([]);
    setNotes('');
    setItems([]);
    setScanState('review');
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Photo library access is needed to import receipts.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      await runOCR(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!storeName.trim()) {
      Alert.alert('Missing field', 'Please enter a store name.');
      return;
    }
    const amountVal = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountVal) || amountVal < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount.');
      return;
    }

    // Final guardrail: if items still don't match the subtotal, give
    // the user one last chance to fix it before persisting. They can
    // confirm "Save anyway" if they've already cross-verified visually.
    const subtotalForCheck = subtotal.trim()
      ? parseFloat(subtotal.replace(',', '.'))
      : null;
    const mismatch = checkItemsAgainstSubtotal(items, subtotalForCheck);
    if (!mismatch.ok) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Line items don't match the subtotal",
          `${mismatch.hint}\n\nItems total: $${mismatch.sum.toFixed(
            2,
          )}\nReceipt subtotal: $${mismatch.subtotal.toFixed(2)}`,
          [
            { text: 'Review items', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Save anyway', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      // Parse the user-typed YYYY-MM-DD as LOCAL time so the saved
      // wall-clock date matches what's on the receipt (see parseYmdLocal).
      const parsedDate: Date = parseYmdLocal(date) ?? new Date();

      const subtotalVal = subtotal.trim() ? parseFloat(subtotal.replace(',', '.')) : undefined;
      const taxVal = tax.trim() ? parseFloat(tax.replace(',', '.')) : undefined;

      // Primary category for dashboard aggregation: prefer the first
      // standard category present in the tag list, otherwise the
      // dominant item category, otherwise 'Other'.
      const primaryCategory: Category =
        (categoryTags.find((t) =>
          (ALL_CATEGORIES as readonly string[]).includes(t),
        ) as Category | undefined) ??
        pickDominantCategory(items) ??
        'Other';
      const finalTags = categoryTags.length ? categoryTags : [primaryCategory];

      // Copy the captured image from cache into persistent storage
      // BEFORE saving — otherwise Android will prune the cache and
      // the receipt's saved imageUri ends up pointing at a missing
      // file, which renders as blank in the edit screen later.
      const receiptId = uuidv4();
      const persistentImageUri = await persistReceiptImage(
        imageUri,
        receiptId,
      );

      await saveReceipt({
        id: receiptId,
        storeName: storeName.trim(),
        date: parsedDate.toISOString(),
        totalAmount: amountVal,
        subtotalAmount: subtotalVal != null && !isNaN(subtotalVal) ? subtotalVal : undefined,
        taxAmount: taxVal != null && !isNaN(taxVal) ? taxVal : undefined,
        category: primaryCategory,
        categoryTags: finalTags,
        rawText: parsed?.rawText,
        imageUri: persistentImageUri,
        notes: notes.trim() || undefined,
        lineItems: items,
        createdAt: now,
        updatedAt: now,
      });

      // Feedback loop: if the user edited items vs. what the parser
      // (regex or AI) returned, save the OCR + corrected items as an
      // example so future scans of this store inherit their fixes.
      // Fire-and-forget — the receipt is already saved; this is just
      // training data.
      const itemsChanged =
        items.length !== parserBaseline.length ||
        items.some((it, i) => {
          const b = parserBaseline[i];
          return (
            !b ||
            b.name !== it.name ||
            Math.abs(b.amount - it.amount) > 0.005 ||
            b.category !== it.category
          );
        });
      if (itemsChanged && rawText && storeName.trim()) {
        saveCorrection({
          storeName: storeName.trim(),
          rawOcr: rawText,
          items,
        }).catch(() => {
          // non-fatal — corrections are best-effort training data
        });
      }

      notifySuccess();
      Alert.alert('Saved!', 'Receipt has been saved successfully.', [
        {
          text: 'View Dashboard',
          onPress: () => {
            resetState();
            router.push('/(tabs)');
          },
        },
        { text: 'Scan Another', onPress: resetState },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to save receipt: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const resetState = () => {
    setScanState('idle');
    setImageUri(null);
    setParsed(null);
    setStoreName('');
    setDate('');
    setAmount('');
    setSubtotal('');
    setTax('');
    setCategory('Other');
    setCategoryTags([]);
    setNotes('');
    setItems([]);
    setShowAllItems(false);
    setEditingItem(null);
    setAiPending(false);
    setAiApplied(false);
    setAiError(null);
    setRawText('');
  };

  // Apply a Gemini-validated receipt into the form state. Used from
  // both the live API path and the cache-hit path.
  /**
   * Compare the running line-item sum against the subtotal we
   * extracted from the receipt and surface an alert if they don't
   * agree within the rounding tolerance. We deliberately keep this
   * as a notification (not an auto-fix) — the safe thing is to ask
   * the user to verify, since silently editing the wrong row would
   * be worse than leaving the mismatch visible.
   */
  const maybeWarnTotalMismatch = (
    nextItems: LineItem[],
    nextSubtotal?: number | null,
  ) => {
    const check = checkItemsAgainstSubtotal(nextItems, nextSubtotal);
    if (check.ok) return;
    Alert.alert(
      "Line items don't match the subtotal",
      `${check.hint}\n\nItems total: $${check.sum.toFixed(
        2,
      )}\nReceipt subtotal: $${check.subtotal.toFixed(
        2,
      )}\n\nPlease cross-verify the line items before saving.`,
      [{ text: 'OK' }],
    );
  };

  const applyAiResult = (
    ai: import('../../lib/geminiParseReceipt').GeminiReceipt,
  ) => {
    setStoreName(ai.storeName);
    if (ai.date) {
      // Gemini returns a bare "YYYY-MM-DD" string. Parse as local
      // time so the displayed date matches the receipt's wall-clock
      // date instead of being shifted by the user's timezone offset.
      const d = parseYmdLocal(ai.date) ?? new Date(ai.date);
      setDate(format(d, 'yyyy-MM-dd'));
    }
    if (ai.totalAmount > 0) setAmount(ai.totalAmount.toFixed(2));
    if (ai.subtotalAmount != null) setSubtotal(ai.subtotalAmount.toFixed(2));
    else setSubtotal('');
    if (ai.taxAmount != null) setTax(ai.taxAmount.toFixed(2));
    else setTax('');
    setItems(ai.lineItems);
    setParserBaseline(ai.lineItems);
    // Sanity-check: do the line items add up to the printed subtotal?
    // A mismatch on a fresh parse usually means OCR dropped or
    // duplicated a row, or the AI mis-attributed a discount. Surface
    // it as a prompt so the user verifies before saving.
    maybeWarnTotalMismatch(ai.lineItems, ai.subtotalAmount);
    const dominantCategory = pickDominantCategory(ai.lineItems);
    if (dominantCategory) setCategory(dominantCategory);
    if (ai.categoryTags && ai.categoryTags.length > 0) {
      setCategoryTags(ai.categoryTags);
    } else {
      const uniq = uniqueItemCategories(ai.lineItems);
      if (uniq.length) setCategoryTags(uniq);
    }
  };

  const runAiParse = async (text: string) => {
    const extra = (Constants.expoConfig?.extra ?? {}) as {
      geminiApiKey?: string;
      parseEndpoint?: string;
      parseEndpointSecret?: string;
    };
    const sharedGeminiKey = extra.geminiApiKey;
    const workerEndpoint = extra.parseEndpoint;
    const workerSecret = extra.parseEndpointSecret;
    const userGeminiKey = await getGeminiApiKey().catch(() => null);

    if (!sharedGeminiKey && !workerEndpoint && !userGeminiKey) {
      setAiError({ kind: 'no-key', message: 'AI not configured for this build.' });
      return;
    }
    setAiPending(true);
    setAiError(null);
    try {
      // Cache hit? Avoid burning a quota request on a receipt we
      // already parsed within the last 24 hours. Repeat scans
      // (testing, OCR retries) used to fail with 429 here.
      const cached = await getGeminiCachedResponse(text).catch(() => null);
      if (cached) {
        const cachedResult = parseGeminiPayload(cached);
        if (cachedResult.ok) {
          applyAiResult(cachedResult.receipt);
          setAiApplied(true);
          setAiError(null);
          return;
        }
      }

      // Pull up to 2 prior user-corrections for whatever store the
      // regex parser thinks this is. The selected backend (Gemini or
      // the Worker) sees these as few-shot examples and tends to
      // mirror their structure — so the more the user scans a given
      // store, the more accurate it gets.
      const guessedStore = (parsed?.storeName || storeName || '').trim();
      const examples = guessedStore
        ? await getRelevantCorrections(guessedStore, 2).catch(() => [])
        : [];

      // Backend selection priority:
      //   1. User's own Gemini key (BYOK) — best quality, their quota
      //   2. App-bundled shared Gemini key — works until daily quota
      //   3. Cloudflare Worker proxy — free Llama 3.3 fallback
      //
      // Each step falls through to the next on rate-limit / auth /
      // network errors so a single quota exhaustion or one provider
      // outage doesn't break the scan.
      const tryBackend = async (
        run: () => ReturnType<typeof parseReceiptWithGemini>,
      ) => {
        let r = await run();
        if (!r.ok && r.kind === 'rate-limited') {
          // Short backoff helps for transient RPM bursts.
          await new Promise((res) => setTimeout(res, 3000));
          r = await run();
        }
        return r;
      };

      let aiResult: Awaited<ReturnType<typeof parseReceiptWithGemini>> | null = null;
      if (userGeminiKey) {
        aiResult = await tryBackend(() =>
          parseReceiptWithGemini(text, userGeminiKey, undefined, examples),
        );
      }
      const isFallbackWorthy = (
        r: Awaited<ReturnType<typeof parseReceiptWithGemini>> | null,
      ) =>
        !r ||
        (!r.ok &&
          (r.kind === 'rate-limited' ||
            r.kind === 'auth' ||
            r.kind === 'network' ||
            r.kind === 'server' ||
            r.kind === 'no-key'));

      if (isFallbackWorthy(aiResult) && sharedGeminiKey) {
        aiResult = await tryBackend(() =>
          parseReceiptWithGemini(text, sharedGeminiKey, undefined, examples),
        );
      }

      if (isFallbackWorthy(aiResult) && workerEndpoint) {
        aiResult = await parseReceiptWithCloudflare({
          rawText: text,
          endpoint: workerEndpoint,
          appSecret: workerSecret,
          examples,
        });
      }

      if (!aiResult || !aiResult.ok) {
        setAiError({
          kind: aiResult?.kind ?? 'unknown',
          message: aiResult?.error ?? 'AI parse failed.',
        });
        return;
      }
      const ai = aiResult.receipt;
      // Replace state if AI returned anything substantive. AI is almost
      // always more accurate than the regex for noisy receipts; the only
      // case to skip replacement is when AI returned a totally empty
      // result.
      const aiUseful =
        ai.lineItems.length > 0 ||
        ai.subtotalAmount != null ||
        ai.taxAmount != null ||
        ai.totalAmount > 0;
      if (!aiUseful) {
        setAiError({ kind: 'empty', message: 'AI returned no usable data.' });
        return;
      }
      applyAiResult(ai);
      setAiApplied(true);
      // Cache the successful response so a re-scan of the same OCR
      // doesn't burn another quota request. We serialize the validated
      // shape (not the raw Gemini envelope) so the read path can use
      // parseGeminiPayload uniformly.
      setGeminiCachedResponse(
        text,
        JSON.stringify({
          store: ai.storeName,
          date: ai.date,
          subtotal: ai.subtotalAmount ?? null,
          tax: ai.taxAmount ?? null,
          total: ai.totalAmount,
          categoryTags: ai.categoryTags,
          items: ai.lineItems.map((it) => ({
            name: it.name,
            amount: it.amount,
            category: it.category ?? 'Other',
          })),
        }),
      ).catch(() => {
        // non-fatal — cache is opportunistic
      });
    } catch (e) {
      setAiError({
        kind: 'unknown',
        message: (e as Error)?.message ?? 'AI parse failed.',
      });
    } finally {
      setAiPending(false);
    }
  };

  // Map an AI failure into a one-line human-readable message + tone.
  // Used by the small chip below the OCR preview. Keep these short
  // and reassuring — the regex parser has already filled the fields.
  const aiErrorMessage = (
    err: { kind: import('../../lib/geminiParseReceipt').GeminiErrorKind } | null,
  ): string => {
    if (!err) return '';
    switch (err.kind) {
      case 'rate-limited':
        return 'AI quota reached — using basic parser. Try again in a few minutes or edit items manually.';
      case 'network':
        return 'No internet for AI — using basic parser. Tap to retry.';
      case 'auth':
        return 'AI key rejected — please check Settings.';
      case 'server':
        return 'AI service is down — using basic parser. Tap to retry.';
      case 'no-key':
        return 'AI not configured.';
      case 'empty':
        return 'AI returned nothing — using basic parser. Tap to retry.';
      case 'parse':
      case 'unknown':
      default:
        return "AI couldn't read this — using basic parser. Tap to retry.";
    }
  };

  const saveEditedItem = (updated: LineItem) => {
    setItems((prev) => {
      // Edit-existing if the id is already in the list; otherwise this
      // is a brand-new item (from `addNewItem` below) being saved for
      // the first time — append it.
      const exists = prev.some((it) => it.id === updated.id);
      return exists
        ? prev.map((it) => (it.id === updated.id ? updated : it))
        : [...prev, updated];
    });
    setEditingItem(null);
  };

  const deleteItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setEditingItem(null);
  };

  /**
   * Open ItemEditModal with a fresh, empty line item. The user fills
   * it in and saves; saveEditedItem detects the new id and appends.
   * If the user cancels (modal closes with no save), nothing is added.
   * Used for manual-entry receipts (which start with an empty items
   * array) and for adding items to AI-parsed receipts that missed one.
   */
  const addNewItem = () => {
    setEditingItem({ id: uuidv4(), name: '', amount: 0 });
  };

  // ─── Idle state (camera capture) ───────────────────────────────────────────
  // The app doesn't render a live in-app camera feed — capture is delegated
  // to the OS camera via expo-image-picker's launchCameraAsync (see
  // pickFromCamera), which owns its own full-screen native UI. This screen
  // is the in-app "ready to shoot" surface shown before that native camera
  // opens, styled to read as a minimal camera viewfinder: a dashed framing
  // guide plus a big shutter button that launches the real camera.
  if (scanState === 'idle') {
    return (
      <View style={styles.cameraScreen}>
        <LinearGradient
          colors={[theme.colors.background, theme.colors.surface]}
          style={styles.viewfinder}
        >
          <Ionicons
            name="camera-outline"
            size={220}
            color={theme.colors.textPrimary}
            style={styles.viewfinderWatermark}
          />
          <View style={styles.frameGuide}>
            <Text style={styles.frameGuideText}>Align receipt within frame</Text>
          </View>
        </LinearGradient>

        <View style={styles.cameraControls}>
          <TouchableOpacity
            style={styles.cameraSideBtn}
            onPress={pickFromGallery}
            activeOpacity={0.75}
          >
            <Ionicons name="images-outline" size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity onPress={pickFromCamera} activeOpacity={0.85}>
            <View style={styles.shutterRing}>
              <View style={styles.shutterFill} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cameraSideBtn}
            onPress={startManualEntry}
            activeOpacity={0.75}
          >
            <Ionicons name="create-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Processing state ───────────────────────────────────────────────────────
  if (scanState === 'processing') {
    return (
      <View style={[styles.screen, styles.centered]}>
        {imageUri && (
          <Image source={{ uri: imageUri }} style={styles.processingImage} />
        )}
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.processingText}>Reading receipt...</Text>
          <Text style={styles.processingSubText}>ML Kit is extracting text on-device</Text>
        </View>
      </View>
    );
  }

  // ─── Review state ───────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.reviewContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.reviewHeader}>
        <Pressable onPress={resetState} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.reviewTitle}>Review Receipt</Text>
      </View>

      {/* Extraction status — wording adapts to the real parsing state
          (pending / succeeded / failed / not-yet-run) rather than a
          single static label. */}
      <View style={styles.statusRow}>
        {aiPending && (
          <View style={[styles.statusBadge, styles.statusBadgePending]}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={[styles.statusText, { color: theme.colors.primary }]}>
              Extracting with AI…
            </Text>
          </View>
        )}
        {!aiPending && aiApplied && (
          <View style={[styles.statusBadge, styles.statusBadgeSuccess]}>
            <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
            <Text style={[styles.statusText, { color: theme.colors.success }]}>
              Extracted — check before saving
            </Text>
          </View>
        )}
        {!aiPending && aiError != null && (
          <TouchableOpacity
            onPress={() => runAiParse(rawText)}
            style={[styles.statusBadge, styles.statusBadgeWarning]}
          >
            <Ionicons name="alert-circle-outline" size={14} color={theme.colors.warning} />
            <Text
              style={[styles.statusText, { color: theme.colors.warning }]}
              numberOfLines={2}
            >
              {aiErrorMessage(aiError)}
            </Text>
          </TouchableOpacity>
        )}
        {!aiPending && !aiApplied && aiError == null && rawText && (
          <TouchableOpacity
            onPress={() => runAiParse(rawText)}
            style={[styles.statusBadge, styles.statusBadgeNeutral]}
          >
            <Ionicons name="sparkles-outline" size={14} color={theme.colors.primary} />
            <Text style={[styles.statusText, { color: theme.colors.primary }]}>
              Re-parse with AI
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.receiptThumb} resizeMode="cover" />
      )}

      {/* Merchant */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Merchant</Text>
        <TextInput
          style={styles.input}
          value={storeName}
          onChangeText={setStoreName}
          placeholder="e.g. Whole Foods Market"
          placeholderTextColor={theme.colors.textMuted}
          autoCorrect={false}
        />
      </Card>

      {/* Amount */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Amount ($)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="decimal-pad"
        />
      </Card>

      {/* Date */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={setDate}
          placeholder="2026-05-08"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        />
      </Card>

      {/* Subtotal */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Subtotal ($) — optional</Text>
        <TextInput
          style={styles.input}
          value={subtotal}
          onChangeText={setSubtotal}
          placeholder="Subtotal before tax"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="decimal-pad"
        />
      </Card>

      {/* Tax */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Tax ($) — optional</Text>
        <TextInput
          style={styles.input}
          value={tax}
          onChangeText={setTax}
          placeholder="Tax amount"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="decimal-pad"
        />
      </Card>

      {/* Category — pill chips. Reuses CategoryTagsPicker (built on top
          of TagChip) rather than a bespoke single-select row so the
          existing multi-tag category support keeps working; selected
          chips render filled with their category accent color. */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Category</Text>
        <CategoryTagsPicker tags={categoryTags} onChange={setCategoryTags} />
      </Card>

      {/* Line items — always rendered so manual-entry receipts have a
          way to add them. Tap a row to edit / delete; tap 'Add item'
          to append a new one. */}
      <Card style={styles.fieldCard}>
        <View style={styles.itemsHeader}>
          <Text style={styles.fieldLabel}>
            {items.length > 0
              ? `Line Items (${items.length})`
              : 'Line Items'}
          </Text>
          {items.length > 0 ? (
            <Text style={styles.itemsHint}>Tap to edit</Text>
          ) : null}
        </View>
        {items.length === 0 ? (
          <Text style={styles.itemsHint}>
            No items yet. Tap "Add item" to log each purchase, or leave
            empty if you only want the total.
          </Text>
        ) : (
          (showAllItems ? items : items.slice(0, 12)).map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setEditingItem(item)}
              style={({ pressed }) => [
                styles.lineItemRow,
                pressed && styles.lineItemRowPressed,
              ]}
            >
              <Text style={styles.lineItemName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.category && <TagChip tag={item.category} size="sm" />}
              <Text style={styles.lineItemAmount}>
                ${item.amount.toFixed(2)}
              </Text>
            </Pressable>
          ))
        )}
        {items.length > 12 && (
          <TouchableOpacity
            onPress={() => setShowAllItems((v) => !v)}
            style={styles.moreItemsBtn}
          >
            <Text style={styles.moreItemsText}>
              {showAllItems
                ? 'Show fewer'
                : `Show ${items.length - 12} more items`}
            </Text>
            <Ionicons
              name={showAllItems ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.colors.primary}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={addNewItem}
          style={styles.addItemBtn}
          activeOpacity={0.7}
        >
          <Ionicons
            name="add-circle-outline"
            size={20}
            color={theme.colors.primary}
          />
          <Text style={styles.addItemBtnText}>Add item</Text>
        </TouchableOpacity>
      </Card>

      {/* Notes */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Add a note"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </Card>

      <ItemEditModal
        item={editingItem}
        extraTags={categoryTags}
        onAddCustomTag={(tag) => {
          // Mirror the edit-receipt screen: a tag added from the per-
          // item picker propagates to the receipt-level tags so all
          // items on this receipt see it.
          setCategoryTags((prev) =>
            prev.some((t) => t.toLowerCase() === tag.toLowerCase())
              ? prev
              : [...prev, tag],
          );
        }}
        onClose={() => setEditingItem(null)}
        onSave={saveEditedItem}
        onDelete={deleteItem}
      />

      <Button
        label="SAVE EXPENSE"
        onPress={handleSave}
        loading={saving}
        size="lg"
        style={styles.saveBtn}
      />
      <Pressable onPress={resetState} style={styles.discardLink} hitSlop={8}>
        <Text style={styles.discardLinkText}>Discard receipt</Text>
      </Pressable>
    </ScrollView>
  );
}

