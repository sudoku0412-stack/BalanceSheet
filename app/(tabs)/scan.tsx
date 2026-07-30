import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Easing,
  Modal,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { v4 as uuidv4 } from 'uuid';
import {
  saveReceipt,
  saveCorrection,
  getRelevantCorrections,
  getGeminiCachedResponse,
  setGeminiCachedResponse,
  getCurrentHouseholdId,
} from '../../lib/database';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { useAuth } from '../../lib/AuthContext';
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
import { useToast } from '../../components/ui/Toast';
import { checkItemsAgainstSubtotal } from '../../lib/itemsTotalCheck';

// Household-member display helpers for the per-item "Split with" picker
// (Add Expense / manual entry only) — mirrors the label/initial logic
// already used for the receipt-level split picker in app/edit/[id].tsx.
function memberLabel(m: HouseholdMember): string {
  return m.displayName?.trim() || m.email?.trim() || 'Member';
}
function initialFor(label: string): string {
  const trimmed = label.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

type ScanState = 'idle' | 'processing' | 'review';

// Full-bleed camera-screen background. This is a literal hex per the
// design export (not a theme token) — the capture UI is always
// near-black regardless of the app's light/dark theme.
const CAMERA_BG = '#0B0B0C';

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
  const params = useLocalSearchParams<{ mode?: string }>();
  const theme = useTheme();
  const toast = useToast();
  const styles = useStyles((t) => ({
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Idle (camera) — full-bleed near-black per the design export; a
    // literal hex rather than a theme token since camera UI is always
    // dark regardless of the app's light/dark theme setting.
    cameraScreen: {
      flex: 1,
      backgroundColor: CAMERA_BG,
    },
    closeBtn: {
      position: 'absolute',
      top: t.spacing.lg,
      right: t.spacing.lg,
      zIndex: 2,
      width: 40,
      height: 40,
      borderRadius: t.radius.full,
      backgroundColor: 'rgba(255,255,255,0.16)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    frameWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.spacing.xl,
    },
    frameGuide: {
      width: '100%',
      maxWidth: 280,
      aspectRatio: 0.7,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: 'rgba(255,255,255,0.55)',
      borderRadius: t.radius.lg,
    },
    frameCaption: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: t.font.sm,
      fontFamily: t.fonts.body.regular,
      textAlign: 'center',
      marginTop: t.spacing.md,
    },
    shutterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.xl,
      paddingBottom: t.spacing.xl,
    },
    sideAction: {
      width: 48,
      height: 48,
      borderRadius: t.radius.full,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterRing: {
      width: 88,
      height: 88,
      borderRadius: t.radius.full,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterButton: {
      width: 72,
      height: 72,
      borderRadius: t.radius.full,
      backgroundColor: '#fff',
    },
    // Processing (capturing)
    spinnerRing: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.25)',
      borderTopColor: '#fff',
    },
    processingOverlay: {
      alignItems: 'center',
      gap: t.spacing.md,
    },
    processingText: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: t.font.sm,
      fontWeight: '800',
      fontFamily: t.fonts.display.bold,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    // Review
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
      marginBottom: t.spacing.xs,
    },
    reviewHeaderTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
    },
    headerIconBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -6,
    },
    // Back chevron + "Retake" label — Review Receipt's header nav,
    // replacing the plain close (X) used on Add Expense.
    retakeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: -8,
      paddingVertical: 4,
      paddingRight: 6,
    },
    retakeText: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '600',
      fontFamily: t.fonts.body.medium,
    },
    reviewTitle: {
      color: t.colors.textPrimary,
      fontSize: t.font.xl,
      fontWeight: '800',
      fontFamily: t.fonts.display.bold,
      letterSpacing: 0.5,
      marginTop: 4,
    },
    // "REVIEW RECEIPT" is rendered fully uppercase per the design
    // export; "Add Expense" (manual-entry mode) stays title case, so
    // this is applied conditionally rather than baked into reviewTitle.
    reviewTitleUppercase: {
      textTransform: 'uppercase',
    },
    reviewEyebrow: {
      color: t.colors.success,
      fontSize: t.font.xs,
      fontWeight: '800',
      fontFamily: t.fonts.display.bold,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 6,
    },
    aiChipPending: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.primaryFaint,
      marginTop: 8,
    },
    aiChipApplied: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.primaryFaint,
      borderWidth: 1,
      borderColor: t.colors.accent,
      marginTop: 8,
    },
    aiChipText: {
      // NOT t.colors.primary — that's dark navy in both themes, so it
      // renders near-invisible (dark-navy text on a dark-navy-ish
      // background) in dark mode. accent (slate blue) stays visible
      // against both light and dark surfaces.
      color: t.colors.accent,
      fontSize: t.font.xs,
      fontWeight: '700',
    },
    aiChipError: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: t.radius.full,
      backgroundColor: 'rgba(245, 158, 11, 0.08)',
      borderWidth: 1,
      borderColor: 'rgba(245, 158, 11, 0.4)',
      marginTop: 8,
      maxWidth: '100%',
    },
    aiChipErrorText: {
      color: t.colors.warning,
      fontSize: t.font.xs,
      fontWeight: '600',
      flexShrink: 1,
    },
    aiRetryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      marginTop: 8,
    },
    fieldCard: {
      gap: t.spacing.sm,
      // Cards are sm/lg radius per the design export — not the large
      // rounded corners the shared Card component's default (t.radius.lg)
      // currently renders at, so it's overridden to the spec's literal
      // 4px here until theme.ts's radius scale is corrected.
      borderRadius: t.radius.lg,
    },
    fieldLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '800',
      fontFamily: t.fonts.display.bold,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    input: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontFamily: t.fonts.body.regular,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    amountInput: {
      fontFamily: t.fonts.mono.medium,
      fontWeight: '500',
    },
    inputMultiline: {
      minHeight: 72,
      paddingTop: 10,
    },
    // Category — single row of tappable colored chips, one per
    // standard Category enum value, colored via t.colors.category[cat]
    // per the design export. Active = filled + white text, inactive =
    // outlined in that category's color.
    categoryChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: t.spacing.xs,
    },
    categoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: t.radius.full,
      borderWidth: 1.5,
    },
    categoryChipText: {
      fontSize: t.font.sm,
      fontWeight: '700',
      fontFamily: t.fonts.body.medium,
    },
    actionsColumn: {
      gap: t.spacing.sm,
      marginTop: t.spacing.sm,
    },
    saveButton: {
      width: '100%',
      height: 52,
      borderRadius: t.radius.lg,
    },
    saveButtonText: {
      fontWeight: '800',
      fontFamily: t.fonts.display.bold,
    },
    discardLink: {
      alignItems: 'center',
      paddingVertical: 10,
    },
    discardLinkText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    // Items section (Add Expense / manual entry only) — per-item name,
    // amount, category dot, and split-with summary, plus an "add item"
    // row that opens the modal below.
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    itemCategoryDot: {
      width: 10,
      height: 10,
      borderRadius: t.radius.full,
    },
    itemRowMain: {
      flex: 1,
      gap: 2,
    },
    itemName: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '600',
      fontFamily: t.fonts.body.medium,
    },
    itemSplitLabel: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontFamily: t.fonts.body.regular,
    },
    itemAmount: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontFamily: t.fonts.mono.medium,
      fontWeight: '500',
    },
    itemRemoveBtn: {
      paddingLeft: 4,
    },
    addItemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
    },
    addItemText: {
      // accent, not primary — primary is dark navy in both themes and
      // is invisible against this screen's dark-navy-ish background
      // in dark mode.
      color: t.colors.accent,
      fontSize: t.font.sm,
      fontWeight: '700',
      fontFamily: t.fonts.body.medium,
    },
    inviteHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      paddingVertical: 4,
    },
    inviteHintText: {
      flex: 1,
      color: t.colors.accent,
      fontSize: t.font.xs,
      fontFamily: t.fonts.body.regular,
    },
    // Item add/edit modal — centered card, same visual language as
    // components/ui/DatePickerModal.tsx.
    itemModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: t.spacing.md,
    },
    itemModalCard: {
      width: '100%',
      maxWidth: 400,
      maxHeight: '85%',
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      padding: t.spacing.md,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    itemModalTitle: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: t.spacing.sm,
    },
    itemModalSpacer: {
      marginTop: t.spacing.sm,
    },
    itemModalFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: t.spacing.md,
    },
    cancelBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: t.radius.full,
    },
    cancelBtnText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    doneBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.accent,
    },
    doneBtnText: {
      color: '#fff',
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    // Split-with avatar row — same pattern as app/edit/[id].tsx's
    // receipt-level split picker, reused here per-item.
    avatarRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    avatarWrap: {
      alignItems: 'center',
      gap: 4,
    },
    avatarCircle: {
      width: 40,
      height: 40,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.surfaceHigh,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    avatarInitial: {
      color: t.colors.textPrimary,
      fontWeight: '700',
      fontSize: t.font.sm,
    },
    avatarLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      maxWidth: 56,
    },
  }));
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [saving, setSaving] = useState(false);

  // Manual-entry receipts never set an image (see startManualEntry
  // below), while every scanned receipt sets one before entering
  // 'review' — even on OCR failure. So this is a reliable way to tell
  // "Review Receipt" (scanned) apart from "Add Expense" (manual) for
  // the header treatment without adding a redundant piece of state.
  const isManualEntry = imageUri === null;

  // 36px "reading receipt" ring: a single white top segment rotating
  // 360° every 0.8s, linear — matches the Capturing-state spec exactly
  // (a plain ActivityIndicator can't produce that exact look).
  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (scanState !== 'processing') return;
    spinAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [scanState, spinAnim]);
  const spinDeg = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Editable fields in review state
  const [storeName, setStoreName] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [tax, setTax] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [categoryTags, setCategoryTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  // Parsed/AI-extracted line items are kept in state and passed through
  // to saveReceipt (see handleSave) even though this screen no longer
  // shows a line-items list or per-item edit UI — Reports' category
  // breakdown and lib/database.ts's saveCorrection learning both depend
  // on this data still being attached to the saved receipt.
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

  // ─── Per-item "Split with" (Add Expense / manual entry only) ──────────────
  const { user } = useAuth();
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);

  // Load household members once we're on the manual-entry screen — the
  // Review Receipt (scanned) path never shows the items UI so there's
  // no need to fetch this otherwise.
  useEffect(() => {
    if (!isManualEntry || scanState !== 'review') return;
    let active = true;
    (async () => {
      try {
        if (!user?.uid) {
          if (active) setHouseholdMembers([]);
          return;
        }
        const hid = getCurrentHouseholdId();
        if (!hid) {
          if (active) setHouseholdMembers([]);
          return;
        }
        const list = await getHouseholdMembers({ householdId: hid, currentUid: user.uid });
        if (active) setHouseholdMembers(list ?? []);
      } catch {
        if (active) setHouseholdMembers([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [isManualEntry, scanState, user?.uid]);

  const otherMembers = useMemo(
    () => householdMembers.filter((m) => !m.isYou),
    [householdMembers],
  );
  // 'self' + every other household member — the full set of ids a line
  // item can be split across. When an item's selected split covers all
  // of these we store splitWith as undefined (LineItem's "everyone"
  // shorthand) rather than an explicit list.
  const participantIds = useMemo(
    () => ['self', ...otherMembers.map((m) => m.uid)],
    [otherMembers],
  );

  // Add/edit line-item modal state
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [itemCategory, setItemCategory] = useState<Category>('Other');
  const [itemSplit, setItemSplit] = useState<Set<string>>(new Set());
  // Tracks whether the user actually tapped a split-with avatar this
  // time the modal is open. Household members load async (Firestore),
  // so `participantIds` at the moment openAddItem() seeds `itemSplit`
  // can be stale/incomplete on a slow connection — snapshotting that
  // set as "the split" would silently exclude a member who just hadn't
  // loaded yet. Untouched means "always everyone, whoever that ends up
  // being" resolved fresh at save time instead of at open time.
  const [itemSplitTouched, setItemSplitTouched] = useState(false);

  const openAddItem = () => {
    setEditingItemId(null);
    setItemName('');
    setItemAmount('');
    setItemCategory('Other');
    setItemSplit(new Set(participantIds));
    setItemSplitTouched(false);
    setItemModalVisible(true);
  };

  const openEditItem = (item: LineItem) => {
    setEditingItemId(item.id);
    setItemName(item.name);
    setItemAmount(item.amount ? String(item.amount) : '');
    setItemCategory(((item.category as Category) || 'Other') as Category);
    // An item that already has an explicit (proper-subset) splitWith was
    // deliberately customized before — honor it as "touched" so re-saving
    // without changes doesn't silently widen it back to everyone.
    const hasExplicitSplit = !!item.splitWith && item.splitWith.length > 0;
    setItemSplit(hasExplicitSplit ? new Set(item.splitWith) : new Set(participantIds));
    setItemSplitTouched(hasExplicitSplit);
    setItemModalVisible(true);
  };

  const closeItemModal = () => setItemModalVisible(false);

  const toggleItemSplit = (id: string) => {
    setItemSplitTouched(true);
    setItemSplit((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveItemModal = () => {
    const trimmedName = itemName.trim();
    if (!trimmedName) {
      toast.show({ message: 'Please enter an item name.', kind: 'error' });
      return;
    }
    const amt = parseFloat(itemAmount.replace(',', '.'));
    if (isNaN(amt) || amt < 0) {
      toast.show({ message: 'Please enter a valid item amount.', kind: 'error' });
      return;
    }
    // Solo household (no other members) — nothing to split, so this
    // item's splitWith always stays undefined regardless of the (not
    // rendered) picker state.
    //
    // "Untouched" also counts as shared-by-everyone REGARDLESS of what
    // itemSplit happens to contain — see itemSplitTouched's declaration
    // for the fetch-race this guards against. Only an itemSplit the
    // user actually edited is trusted as an intentional subset.
    const sharedByEveryone =
      otherMembers.length === 0 ||
      !itemSplitTouched ||
      itemSplit.size >= participantIds.length;
    const newItem: LineItem = {
      id: editingItemId ?? uuidv4(),
      name: trimmedName,
      amount: amt,
      category: itemCategory,
      splitWith: sharedByEveryone ? undefined : Array.from(itemSplit),
    };
    setItems((prev) =>
      editingItemId
        ? prev.map((it) => (it.id === editingItemId ? newItem : it))
        : [...prev, newItem],
    );
    setItemModalVisible(false);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // "Split with 2 people" / "You only" summary shown on each item row.
  const splitSummaryLabel = (item: LineItem): string => {
    if (otherMembers.length === 0) return 'You only';
    const resolvedCount =
      item.splitWith && item.splitWith.length
        ? item.splitWith.length
        : participantIds.length;
    if (resolvedCount <= 1) return 'You only';
    return `Split with ${resolvedCount} people`;
  };

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

  // Lets other screens (Home's "+ Add manually", Expenses' "+") deep-link
  // straight into manual entry via router.push('/(tabs)/scan?mode=manual').
  //
  // This MUST be focus-based, not a mount/param-change effect: expo-router
  // tabs stay mounted, so a mount-once effect only fires the very first
  // time this tab is visited. Every subsequent "+ Add manually" tap while
  // this screen already has some other state loaded (e.g. a scanned
  // receipt left over from a prior camera capture, or a previous manual
  // entry the user navigated away from without tapping Save/Close) would
  // silently no-op, leaving the user staring at that stale screen with no
  // "Add item" button (because it wasn't actually the manual-entry state).
  // Re-running startManualEntry() on every focus while the param is
  // present fixes that — it always resets to a fresh manual entry form.
  useFocusEffect(
    useCallback(() => {
      // Skip if we're already sitting in a live manual-entry form — a
      // plain tab-switch-away-and-back re-focuses this screen without
      // the user asking for a fresh form, and resetting here would wipe
      // whatever they'd already typed.
      const alreadyInFreshManualEntry = isManualEntry && scanState === 'review';
      if (params.mode === 'manual' && !alreadyInFreshManualEntry) {
        startManualEntry();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.mode, isManualEntry, scanState]),
  );

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
      toast.show({ message: 'Please enter a merchant name.', kind: 'error' });
      return;
    }
    const amountVal = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountVal) || amountVal < 0) {
      toast.show({ message: 'Please enter a valid amount.', kind: 'error' });
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
      toast.show({
        message: `Saved to ${primaryCategory}`,
        kind: 'success',
      });
      resetState();
      // Return to wherever the user came from (the Home "+ Add
      // manually" quick action or the Expenses "+" button both push
      // this screen, so the router stack has a prior entry to pop
      // back to). Fall back to the dashboard if this screen was the
      // initial route (e.g. deep link).
      if (router.canGoBack()) {
        router.back();
      } else {
        router.push('/(tabs)');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.show({ message: `Failed to save: ${msg}`, kind: 'error' });
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
    setAiPending(false);
    setAiApplied(false);
    setAiError(null);
    setRawText('');
    setItemModalVisible(false);
    setEditingItemId(null);
  };

  // Back chevron ("Retake") in the Review Receipt header: discard the
  // capture and return to the camera (idle) screen, staying on this tab.
  const closeScan = () => resetState();

  // Top-right close (X) on the camera (idle) screen and on the Add
  // Expense header: exit back to wherever the user came from. Both are
  // pushed onto the stack from Home's "+ Add manually" quick action or
  // the Expenses "+" button, so router.back() pops back to that screen;
  // fall back to the dashboard if this was the initial route.
  const exitScan = () => {
    resetState();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push('/(tabs)');
    }
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

  // ─── Idle state (Scan / camera) ─────────────────────────────────────────────
  // Full-bleed near-black camera screen: close (X) top-right, a dashed
  // guide frame with caption centered, and a 72px shutter at the
  // bottom. Gallery-import and manual-entry aren't part of the design
  // export's camera screen, but both are existing features that must
  // keep working, so they ride along as small icon affordances either
  // side of the shutter rather than the old two-card grid.
  if (scanState === 'idle') {
    return (
      <View style={styles.cameraScreen}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={exitScan}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={styles.frameWrap}>
          <View style={styles.frameGuide} />
          <Text style={styles.frameCaption}>Align receipt within frame</Text>
        </View>

        <View style={styles.shutterRow}>
          <TouchableOpacity
            style={styles.sideAction}
            onPress={pickFromGallery}
            activeOpacity={0.7}
          >
            <Ionicons name="images-outline" size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity onPress={pickFromCamera} activeOpacity={0.8}>
            <View style={styles.shutterRing}>
              <View style={styles.shutterButton} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sideAction}
            onPress={startManualEntry}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Processing state (Capturing) ───────────────────────────────────────────
  if (scanState === 'processing') {
    return (
      <View style={[styles.cameraScreen, styles.centered]}>
        <View style={styles.processingOverlay}>
          <Animated.View
            style={[styles.spinnerRing, { transform: [{ rotate: spinDeg }] }]}
          />
          <Text style={styles.processingText}>Reading receipt…</Text>
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
      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.receiptThumb} resizeMode="cover" />
      )}

      <View style={styles.reviewHeader}>
        <View style={styles.reviewHeaderTop}>
          {isManualEntry ? (
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={exitScan}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.retakeBtn}
              onPress={closeScan}
              activeOpacity={0.7}
            >
              <Ionicons
                name="chevron-back"
                size={22}
                color={theme.colors.textPrimary}
              />
              <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text
          style={[
            styles.reviewTitle,
            !isManualEntry && styles.reviewTitleUppercase,
          ]}
        >
          {isManualEntry ? 'Add Expense' : 'Review Receipt'}
        </Text>
        {!isManualEntry && (
          <Text style={styles.reviewEyebrow}>
            Extracted — check before saving
          </Text>
        )}
        {aiPending && (
          <View style={styles.aiChipPending}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.aiChipText}>Improving with AI…</Text>
          </View>
        )}
        {!aiPending && aiApplied && (
          <View style={styles.aiChipApplied}>
            <Ionicons name="sparkles" size={14} color={theme.colors.accent} />
            <Text style={styles.aiChipText}>AI improved this receipt</Text>
          </View>
        )}
        {!aiPending && aiError != null && (
          <TouchableOpacity
            onPress={() => runAiParse(rawText)}
            style={styles.aiChipError}
          >
            <Ionicons
              name="information-circle-outline"
              size={14}
              color={theme.colors.warning}
            />
            <Text style={styles.aiChipErrorText} numberOfLines={2}>
              {aiErrorMessage(aiError)}
            </Text>
          </TouchableOpacity>
        )}
        {!aiPending && !aiApplied && aiError == null && rawText && (
          <TouchableOpacity
            onPress={() => runAiParse(rawText)}
            style={styles.aiRetryBtn}
          >
            <Ionicons name="sparkles-outline" size={14} color={theme.colors.accent} />
            <Text style={styles.aiChipText}>Re-parse with AI</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Merchant — 1 of the exactly-4 editable fields per the design
          export (Merchant, Amount, Category, Notes). Date/Subtotal/Tax
          are still tracked internally (from OCR/AI parse, used for the
          subtotal-mismatch guardrail and saved on the receipt) but are
          no longer user-editable fields on this screen. */}
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

      {/* Amount — Roboto Mono per the design export's numeric-field spec. */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Amount</Text>
        <TextInput
          style={[styles.input, styles.amountInput]}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="decimal-pad"
        />
      </Card>

      {/* Category — single row of tappable colored chips, one per
          standard Category value. Selecting a chip both sets the
          receipt's primary category and promotes it to the front of
          categoryTags (used by Reports' category breakdown) while
          preserving any other AI-suggested tags already present. */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Category</Text>
        <View style={styles.categoryChipsRow}>
          {ALL_CATEGORIES.map((cat) => {
            const active = category === cat;
            const color = theme.colors.category[cat];
            return (
              <TouchableOpacity
                key={cat}
                onPress={() => {
                  setCategory(cat);
                  setCategoryTags((prev) => [
                    cat,
                    ...prev.filter((t) => t.toLowerCase() !== cat.toLowerCase()),
                  ]);
                }}
                activeOpacity={0.7}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: active ? color : 'transparent',
                    borderColor: color,
                  },
                ]}
              >
                {active && (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                )}
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: active ? '#fff' : color },
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* Notes */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Add any notes..."
          placeholderTextColor={theme.colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </Card>

      {/* Items — manual entry only. Review Receipt (scanned) keeps its
          simple 4-field form; OCR/AI line items still flow through
          invisibly via the `items` state passed to handleSave. */}
      {isManualEntry && (
        <Card style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>
            Items{items.length ? ` (${items.length})` : ''}
          </Text>
          {items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
                onPress={() => openEditItem(item)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.itemCategoryDot,
                    {
                      backgroundColor:
                        theme.colors.category[((item.category as Category) || 'Other') as Category],
                    },
                  ]}
                />
                <View style={styles.itemRowMain}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.itemSplitLabel}>{splitSummaryLabel(item)}</Text>
                </View>
                <Text style={styles.itemAmount}>${item.amount.toFixed(2)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeItem(item.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.itemRemoveBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addItemRow} onPress={openAddItem} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={18} color={theme.colors.accent} />
            <Text style={styles.addItemText}>Add item</Text>
          </TouchableOpacity>
        </Card>
      )}

      {/* Add/edit line-item modal */}
      <Modal
        visible={itemModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeItemModal}
      >
        <Pressable style={styles.itemModalBackdrop} onPress={closeItemModal}>
          <Pressable style={styles.itemModalCard} onPress={() => {}}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.itemModalTitle}>
                {editingItemId ? 'Edit Item' : 'Add Item'}
              </Text>

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={itemName}
                onChangeText={setItemName}
                placeholder="e.g. Milk"
                placeholderTextColor={theme.colors.textMuted}
                autoCorrect={false}
              />

              <Text style={[styles.fieldLabel, styles.itemModalSpacer]}>Amount</Text>
              <TextInput
                style={[styles.input, styles.amountInput]}
                value={itemAmount}
                onChangeText={setItemAmount}
                placeholder="0.00"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={[styles.fieldLabel, styles.itemModalSpacer]}>Category</Text>
              <View style={styles.categoryChipsRow}>
                {ALL_CATEGORIES.map((cat) => {
                  const active = itemCategory === cat;
                  const color = theme.colors.category[cat];
                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setItemCategory(cat)}
                      activeOpacity={0.7}
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor: active ? color : 'transparent',
                          borderColor: color,
                        },
                      ]}
                    >
                      {active && <Ionicons name="checkmark" size={14} color="#fff" />}
                      <Text
                        style={[
                          styles.categoryChipText,
                          { color: active ? '#fff' : color },
                        ]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {otherMembers.length === 0 && (
                <TouchableOpacity
                  style={styles.inviteHintRow}
                  onPress={() => router.push('/settings')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="person-add-outline" size={14} color={theme.colors.accent} />
                  <Text style={styles.inviteHintText}>
                    Nobody to split with yet — invite someone in Settings → Household
                  </Text>
                </TouchableOpacity>
              )}

              {otherMembers.length > 0 && (
                <>
                  <Text style={[styles.fieldLabel, styles.itemModalSpacer]}>
                    Split with
                  </Text>
                  <View style={[styles.avatarRow, { marginTop: 8 }]}>
                    <TouchableOpacity
                      style={styles.avatarWrap}
                      onPress={() => toggleItemSplit('self')}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.avatarCircle,
                          {
                            borderColor: itemSplit.has('self')
                              ? theme.colors.accent
                              : 'transparent',
                            opacity: itemSplit.has('self') ? 1 : 0.35,
                          },
                        ]}
                      >
                        <Text style={styles.avatarInitial}>Y</Text>
                      </View>
                      <Text style={styles.avatarLabel} numberOfLines={1}>
                        You
                      </Text>
                    </TouchableOpacity>
                    {otherMembers.map((m) => {
                      const label = memberLabel(m);
                      const active = itemSplit.has(m.uid);
                      return (
                        <TouchableOpacity
                          key={m.uid}
                          style={styles.avatarWrap}
                          onPress={() => toggleItemSplit(m.uid)}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.avatarCircle,
                              {
                                borderColor: active ? theme.colors.accent : 'transparent',
                                opacity: active ? 1 : 0.35,
                              },
                            ]}
                          >
                            <Text style={styles.avatarInitial}>{initialFor(label)}</Text>
                          </View>
                          <Text style={styles.avatarLabel} numberOfLines={1}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <View style={styles.itemModalFooter}>
                <TouchableOpacity onPress={closeItemModal} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveItemModal} style={styles.doneBtn}>
                  <Text style={styles.doneBtnText}>
                    {editingItemId ? 'Save' : 'Add'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.actionsColumn}>
        {/* Full-width 52px navy "Save Expense" primary button per the
            design export. Discard isn't part of the exported mockup
            but is existing, required functionality, so it stays as a
            lower-emphasis text link underneath rather than disappearing. */}
        <Button
          label="Save Expense"
          onPress={handleSave}
          loading={saving}
          style={styles.saveButton}
          textStyle={styles.saveButtonText}
        />
        <TouchableOpacity
          style={styles.discardLink}
          onPress={resetState}
          activeOpacity={0.7}
        >
          <Text style={styles.discardLinkText}>Discard</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

