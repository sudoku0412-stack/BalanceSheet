import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
  Platform,
  ActivityIndicator,
  Pressable,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import {
  getReceiptById,
  updateReceipt,
  deleteReceipt,
  getAllReceipts,
  getCurrentHouseholdId,
} from '../../lib/database';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { useAuth } from '../../lib/AuthContext';
import { findRecurring } from '../../lib/reports';
import { parseYmdLocal } from '../../lib/parser';
import { notifySuccess, tapLight, tapMedium } from '../../lib/haptics';
import {
  formatCurrency,
  CURRENCY_SYMBOLS,
  CURRENCIES,
  CurrencyCode,
} from '../../lib/currency';
import { getCurrency } from '../../lib/secureStorage';
import { Receipt, Category } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES } from '../../constants/categories';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CategoryTagsPicker } from '../../components/ui/CategoryTagsPicker';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';

/** Validate the persisted currency code, defaulting to USD when unset
 *  or unrecognized (matches lib/currency.ts's canonical-USD design). */
function toCurrencyCode(raw: string | null): CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(raw ?? '')
    ? (raw as CurrencyCode)
    : 'USD';
}

/** Safe wrapper around date-fns format(). Legacy receipts may have
 *  missing/invalid createdAt/updatedAt fields; format() throws
 *  "Invalid time value" on a NaN Date, which crashes the screen
 *  render (background-only blue screen visible to the user). Return
 *  empty string for invalid input so the caller can render nothing
 *  instead of crashing. */
function safeFormat(input: unknown, fmt: string): string {
  if (input == null || input === '') return '';
  try {
    const d = new Date(input as string);
    if (isNaN(d.getTime())) return '';
    return format(d, fmt);
  } catch {
    return '';
  }
}

/** Defensive toFixed — null/undefined/NaN amounts on legacy receipts
 *  would crash the whole render via `undefined.toFixed`. */
function safeAmount(n: number | null | undefined, digits = 2): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0.00';
  return n.toFixed(digits);
}

function memberLabel(m: HouseholdMember): string {
  return m.displayName?.trim() || m.email?.trim() || 'Member';
}

function initialFor(label: string): string {
  const trimmed = label.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export default function EditReceiptScreenWrapped() {
  return (
    <ErrorBoundary>
      <EditReceiptScreen />
    </ErrorBoundary>
  );
}

function EditReceiptScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const styles = useStyles((t) => ({
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      padding: t.spacing.md,
      gap: t.spacing.sm,
      paddingBottom: 40,
    },
    notFoundText: {
      color: t.colors.textSecondary,
      fontSize: t.font.lg,
      marginBottom: t.spacing.md,
    },
    // ── Custom header (back chevron + "EXPENSE" label) ──
    // Rendered by this screen itself (native header hidden via the
    // <Stack.Screen options={{ headerShown: false }} /> below) so the
    // exact spacing/typography from the design export can be matched
    // without touching the shared app/_layout.tsx Stack config.
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: t.spacing.sm,
    },
    headerBackBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerLabel: {
      fontFamily: t.fonts.display.extraBold,
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    headerSpacer: {
      width: 32,
    },
    image: {
      width: '100%',
      height: 200,
      borderRadius: t.radius.lg,
      marginBottom: t.spacing.xs,
    },
    imagePlaceholder: {
      height: 120,
      width: 120,
      alignSelf: 'center',
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing.sm,
      backgroundColor: t.colors.surface,
    },
    merchantInput: {
      fontFamily: t.fonts.display.bold,
      color: t.colors.textPrimary,
      fontSize: t.font.xl,
      padding: 0,
    },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop: t.spacing.xs,
    },
    amountCurrency: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textPrimary,
      fontSize: t.font.xxl,
      marginRight: 2,
      fontWeight: '600',
    },
    amountInput: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textPrimary,
      fontSize: t.font.xxxl,
      fontWeight: '600',
      padding: 0,
      flex: 1,
    },
    captionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: t.spacing.xs,
    },
    captionText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
    },
    captionDateInput: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      padding: 0,
      minWidth: 90,
    },
    meta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: 2,
      marginBottom: t.spacing.xs,
    },
    metaText: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
    },
    // ── Category row: colored dot + primary category name + optional
    // "Recurring" pill (findRecurring-backed, see render code). ──
    categoryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: t.spacing.sm,
    },
    categoryDot: {
      width: 10,
      height: 10,
      borderRadius: 999,
    },
    categoryRowLabel: {
      fontFamily: t.fonts.display.bold,
      color: t.colors.textPrimary,
      fontSize: t.font.md,
    },
    recurringBadge: {
      backgroundColor: t.colors.accent,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: t.radius.full,
    },
    recurringBadgeText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: t.font.xs,
    },
    fieldCard: {
      gap: t.spacing.sm,
      borderRadius: t.radius.lg,
    },
    sectionLabel: {
      fontFamily: t.fonts.display.extraBold,
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
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
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    inputMultiline: {
      minHeight: 72,
      paddingTop: 10,
    },
    notesText: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
    },
    saveBtn: {
      marginTop: t.spacing.sm,
    },
    // ── Delete button: full-width outlined error/oxblood, per spec ──
    deleteBtnOutlined: {
      marginTop: t.spacing.xs,
      borderWidth: 1,
      borderColor: t.colors.error,
      borderRadius: t.radius.lg,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    deleteBtnOutlinedText: {
      color: t.colors.error,
      fontWeight: '700',
      fontSize: t.font.md,
    },
    // ── Split section ──
    splitToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    splitToggleLabel: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '600',
    },
    splitBody: {
      marginTop: t.spacing.md,
      gap: t.spacing.md,
    },
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
    segmented: {
      flexDirection: 'row',
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      overflow: 'hidden',
    },
    segmentedTab: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentedTabText: {
      fontSize: t.font.sm,
      fontWeight: '600',
      color: t.colors.textSecondary,
    },
    participantRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    participantName: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      flex: 1,
    },
    participantValueReadOnly: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
    },
    participantInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    participantInput: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 8,
      paddingVertical: 4,
      width: 60,
      textAlign: 'right',
    },
    participantComputed: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      minWidth: 56,
      textAlign: 'right',
    },
    splitWarning: {
      color: t.colors.error,
      fontSize: t.font.xs,
    },
    splitSummary: {
      color: t.colors.success,
      fontWeight: '700',
      fontSize: t.font.sm,
      marginTop: t.spacing.xs,
    },
  }));
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [storeName, setStoreName] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [categoryTags, setCategoryTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  // True once the <Image> reports it couldn't load — likely a stale
  // cache URI from a receipt scanned before persistReceiptImage was
  // introduced. We hide the broken image area entirely and fall back
  // to the placeholder tile instead of reserving blank space.
  const [imageMissing, setImageMissing] = useState(false);
  // User's selected display currency (lib/secureStorage.getCurrency).
  // Defaults to USD until loaded / if unset.
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('USD');
  // Whether findRecurring (lib/reports.ts) flags this receipt's store
  // as part of a real recurring pattern — drives the "Recurring" pill.
  const [isRecurring, setIsRecurring] = useState(false);

  // ── Split-this-expense state ──
  // Mirrors Receipt.split (types/index.ts): { enabled, method,
  // participantIds, values }. Initialized from receipt.split on load
  // (see the load effect below) and written back into the Receipt on
  // save (see handleSave) — this is now real, persisted state.
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitMethod, setSplitMethod] = useState<'equal' | 'percent' | 'amount'>('equal');
  const [selectedOtherUids, setSelectedOtherUids] = useState<Set<string>>(new Set());
  // Keyed by 'self' for the always-included "You" and by household
  // member uid for everyone else — matches Receipt.split.values keys.
  const [splitPercents, setSplitPercents] = useState<Record<string, string>>({});
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    (async () => {
      const r = await getReceiptById(id);
      if (!mounted || !r) {
        if (mounted) setLoading(false);
        return;
      }
      setReceipt(r);
      setStoreName(r.storeName);
      setDate(safeFormat(r.date, 'yyyy-MM-dd'));
      setAmount(safeAmount(r.totalAmount));
      setCategory(r.category);
      setCategoryTags(r.categoryTags ?? [r.category]);
      setNotes(r.notes ?? '');

      // Initialize split UI state from the persisted split field, if any.
      if (r.split?.enabled) {
        setSplitEnabled(true);
        setSplitMethod(r.split.method);
        const others = r.split.participantIds.filter((p) => p !== 'self');
        setSelectedOtherUids(new Set(others));
        if (r.split.method === 'percent') {
          const pct: Record<string, string> = {};
          for (const [k, v] of Object.entries(r.split.values ?? {})) {
            pct[k] = String(v);
          }
          setSplitPercents(pct);
        } else if (r.split.method === 'amount') {
          const amt: Record<string, string> = {};
          for (const [k, v] of Object.entries(r.split.values ?? {})) {
            amt[k] = String(v);
          }
          setSplitAmounts(amt);
        }
      }

      setLoading(false);

      // Verify the receipt's image actually exists on disk. Older
      // scans saved a temp-cache URI that Android may have since
      // pruned — if the file is gone, hide the image area entirely
      // instead of reserving space for it (which renders as a
      // navy rectangle on top of the screen).
      if (r.imageUri) {
        try {
          const info = await FileSystem.getInfoAsync(r.imageUri);
          if (mounted && !info.exists) setImageMissing(true);
        } catch {
          if (mounted) setImageMissing(true);
        }
      } else {
        // No URI saved at all — same effect, just skip the network check.
        setImageMissing(true);
      }

      // Real recurring detection (lib/reports.findRecurring) against
      // every receipt in the household — flags the "Recurring" pill
      // only when this receipt's store genuinely repeats across
      // multiple months. Never fabricated.
      try {
        const all = await getAllReceipts();
        const matches = findRecurring(all);
        const storeKey = r.storeName.trim().toLowerCase() || 'unknown store';
        const recurring = matches.some((m) => m.kind === 'store' && m.label === storeKey);
        if (mounted) setIsRecurring(recurring);
      } catch {
        // best-effort; leave isRecurring false
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  // User's selected display currency (lib/secureStorage.getCurrency).
  useEffect(() => {
    let mounted = true;
    (async () => {
      const raw = await getCurrency();
      if (mounted) setCurrencyCode(toCurrencyCode(raw));
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Real household members (lib/cloudSync.getHouseholdMembers), mirroring
  // the FamilyPanel fetch pattern in app/settings.tsx. Used as the split
  // participant list — no fictional demo names.
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user?.uid) {
        if (mounted) setHouseholdMembers([]);
        return;
      }
      const hid = getCurrentHouseholdId();
      if (!hid) {
        if (mounted) setHouseholdMembers([]);
        return;
      }
      const list = await getHouseholdMembers({ householdId: hid, currentUid: user.uid });
      if (mounted) setHouseholdMembers(list ?? []);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.uid]);

  const handleSave = async () => {
    if (!receipt) return;
    if (!storeName.trim()) {
      Alert.alert('Missing field', 'Please enter a store name.');
      return;
    }
    const amountVal = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountVal) || amountVal < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount.');
      return;
    }

    // Parse the user-typed YYYY-MM-DD as LOCAL time so the wall-clock
    // date the user sees survives the save → reload round-trip.
    const parsedDate: Date = parseYmdLocal(date) ?? new Date(receipt.date);

    setSaving(true);
    try {
      // Derive primary category from the tag list — first standard
      // category found, fall back to existing primary if all tags
      // are custom strings.
      const primary: Category =
        (categoryTags.find((t) =>
          (ALL_CATEGORIES as readonly string[]).includes(t),
        ) as Category | undefined) ?? category;

      // Build the split payload from the current split UI state —
      // this now actually persists (Receipt.split, types/index.ts).
      const split: Receipt['split'] = splitEnabled
        ? {
            enabled: true,
            method: splitMethod,
            participantIds: ['self', ...Array.from(selectedOtherUids)],
            values:
              splitMethod === 'percent'
                ? Object.fromEntries(
                    Object.entries(splitPercents).map(([k, v]) => [k, parseFloat(v) || 0]),
                  )
                : splitMethod === 'amount'
                  ? Object.fromEntries(
                      Object.entries(splitAmounts).map(([k, v]) => [k, parseFloat(v) || 0]),
                    )
                  : undefined,
          }
        : { enabled: false, method: splitMethod, participantIds: ['self'] };

      await updateReceipt({
        ...receipt,
        storeName: storeName.trim(),
        date: parsedDate.toISOString(),
        totalAmount: amountVal,
        category: primary,
        categoryTags: categoryTags.length ? categoryTags : [primary],
        notes: notes.trim() || undefined,
        split,
      });
      notifySuccess();
      router.back();
    } catch {
      Alert.alert('Error', 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    // Keep the existing confirm-before-delete Alert — the design
    // handoff prototype deletes immediately + shows a toast, but this
    // codebase already has a safety check here and it stays intact.
    Alert.alert('Delete Receipt', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!receipt) return;
          tapMedium();
          await deleteReceipt(receipt.id);
          router.back();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!receipt) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.notFoundText}>Receipt not found</Text>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  // ── Split math ── values are entered in the receipt's own amount
  // units; formatCurrency below just re-renders them in the user's
  // selected display currency.
  const totalAmountVal = parseFloat(amount.replace(',', '.')) || 0;
  const otherMembers = (householdMembers ?? []).filter((m) => !m.isYou);
  const selectedOthers = otherMembers.filter((m) => selectedOtherUids.has(m.uid));
  const participantCount = 1 + selectedOthers.length; // "You" + selected others

  let yourShare = 0;
  let owedToYou = 0;
  let splitWarning: string | null = null;

  if (splitMethod === 'equal') {
    yourShare = participantCount > 0 ? totalAmountVal / participantCount : totalAmountVal;
    owedToYou = totalAmountVal - yourShare;
  } else if (splitMethod === 'percent') {
    const yourPct = parseFloat(splitPercents.self || '0') || 0;
    const othersPct = selectedOthers.reduce(
      (s, m) => s + (parseFloat(splitPercents[m.uid] || '0') || 0),
      0,
    );
    const sumPct = yourPct + othersPct;
    yourShare = (yourPct / 100) * totalAmountVal;
    owedToYou = (othersPct / 100) * totalAmountVal;
    if (Math.abs(sumPct - 100) > 0.01) {
      splitWarning = `Percentages add up to ${sumPct.toFixed(0)}%, not 100%.`;
    }
  } else {
    const yourAmt = parseFloat(splitAmounts.self || '0') || 0;
    const othersAmt = selectedOthers.reduce(
      (s, m) => s + (parseFloat(splitAmounts[m.uid] || '0') || 0),
      0,
    );
    const sumAmt = yourAmt + othersAmt;
    yourShare = yourAmt;
    owedToYou = othersAmt;
    if (Math.abs(sumAmt - totalAmountVal) > 0.01) {
      splitWarning = `Amounts add up to ${formatCurrency(sumAmt, currencyCode)}, not ${formatCurrency(totalAmountVal, currencyCode)}.`;
    }
  }

  const toggleOtherParticipant = (uid: string) => {
    tapLight();
    const next = new Set(selectedOtherUids);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    setSelectedOtherUids(next);
  };

  return (
    <View style={styles.screen}>
      {/* Native header hidden in favor of the custom back-chevron +
          "EXPENSE" label row below, matching the design export. */}
      <Stack.Screen options={{ headerShown: false }} />
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.headerBackBtn}
        >
          <Ionicons name="chevron-back" size={26} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerLabel}>EXPENSE</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Receipt image — hides itself if the file is missing (older
          receipts may have stale cache:// paths from before we
          started copying to documentDirectory on save) and shows a
          bordered placeholder tile with a centered receipt icon
          instead, per the design export. */}
      {receipt.imageUri && !imageMissing ? (
        <Image
          source={{ uri: receipt.imageUri }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setImageMissing(true)}
        />
      ) : receipt.photoUrl ? (
        <Image
          source={{ uri: receipt.photoUrl }}
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Ionicons name="receipt-outline" size={40} color={theme.colors.textMuted} />
        </View>
      )}

      {/* Merchant name — styled as the 20px bold "display" heading from
          the export, but kept as an editable field (existing feature). */}
      <TextInput
        style={styles.merchantInput}
        value={storeName}
        onChangeText={setStoreName}
        placeholder="Store name"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
      />

      {/* Amount — 32px Manrope ExtraBold container, Roboto Mono digits,
          per the Design Tokens section of the handoff. Currency symbol
          reflects the user's selected currency (lib/secureStorage
          .getCurrency); still an editable field. */}
      <View style={styles.amountRow}>
        <Text style={styles.amountCurrency}>{CURRENCY_SYMBOLS[currencyCode]}</Text>
        <TextInput
          style={styles.amountInput}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.colors.textMuted}
        />
      </View>

      {/* "{date} · {payment method}" caption. There is no payment-method
          field on Receipt (types/index.ts), so only the date renders —
          left out rather than fabricated. Date stays editable. */}
      <View style={styles.captionRow}>
        <TextInput
          style={styles.captionDateInput}
          value={date}
          onChangeText={setDate}
          placeholder="2026-05-08"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        />
      </View>

      {/* Added/edited timestamps — pre-existing info, tucked below the
          transaction-date caption rather than removed. */}
      <View style={styles.meta}>
        {safeFormat(receipt.createdAt, 'MMM d, yyyy · h:mm a') !== '' && (
          <Text style={styles.metaText}>
            Added {safeFormat(receipt.createdAt, 'MMM d, yyyy · h:mm a')}
          </Text>
        )}
        {receipt.updatedAt &&
          receipt.updatedAt !== receipt.createdAt &&
          safeFormat(receipt.updatedAt, 'MMM d, yyyy') !== '' && (
            <Text style={styles.metaText}>
              Edited {safeFormat(receipt.updatedAt, 'MMM d, yyyy')}
            </Text>
          )}
      </View>

      {/* Category row — colored dot + primary category name + an
          optional "Recurring" pill (only shown when findRecurring,
          lib/reports.ts, genuinely flags this receipt's store as a
          repeating pattern — not fabricated). The full multi-tag
          picker (existing feature) stays right below it for actually
          changing categories/tags. */}
      <Card style={styles.fieldCard}>
        <View style={styles.categoryRow}>
          <View
            style={[
              styles.categoryDot,
              { backgroundColor: theme.colors.category[category] },
            ]}
          />
          <Text style={styles.categoryRowLabel}>{category}</Text>
          {isRecurring && (
            <View style={styles.recurringBadge}>
              <Text style={styles.recurringBadgeText}>Recurring</Text>
            </View>
          )}
        </View>
        <CategoryTagsPicker tags={categoryTags} onChange={setCategoryTags} />
      </Card>

      {/* Split section (Splitwise-style). Toggle reveals participant
          picker + Equal/%/$ method switch. Persists on save via the
          `split` field on Receipt (types/index.ts). */}
      <Card style={styles.fieldCard}>
        <Text style={styles.sectionLabel}>SPLIT</Text>
        <View style={styles.splitToggleRow}>
          <Text style={styles.splitToggleLabel}>Split this expense</Text>
          <Switch
            value={splitEnabled}
            onValueChange={setSplitEnabled}
            trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
          />
        </View>

        {splitEnabled && (
          <View style={styles.splitBody}>
            {/* Participant picker — "You" always included and not
                removable; other avatars are real household members
                (lib/cloudSync.getHouseholdMembers), not demo names. */}
            <View style={styles.avatarRow}>
              <View style={styles.avatarWrap}>
                <View
                  style={[
                    styles.avatarCircle,
                    { borderColor: theme.colors.accent, opacity: 1 },
                  ]}
                >
                  <Text style={styles.avatarInitial}>Y</Text>
                </View>
                <Text style={styles.avatarLabel} numberOfLines={1}>You</Text>
              </View>
              {otherMembers.map((m) => {
                const label = memberLabel(m);
                const active = selectedOtherUids.has(m.uid);
                return (
                  <TouchableOpacity
                    key={m.uid}
                    style={styles.avatarWrap}
                    onPress={() => toggleOtherParticipant(m.uid)}
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
                    <Text style={styles.avatarLabel} numberOfLines={1}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
              {/* No members yet: household may still be loading, or this
                  is a solo household. Not fabricated — just "You". */}
            </View>

            {/* Method switch — 3-way segmented control */}
            <View style={styles.segmented}>
              {(['equal', 'percent', 'amount'] as const).map((m) => {
                const active = splitMethod === m;
                const label = m === 'equal' ? 'Equal' : m === 'percent' ? '%' : '$';
                return (
                  <Pressable
                    key={m}
                    style={[
                      styles.segmentedTab,
                      active && { backgroundColor: theme.colors.accent },
                    ]}
                    onPress={() => setSplitMethod(m)}
                  >
                    <Text
                      style={[
                        styles.segmentedTabText,
                        active && { color: '#fff' },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Per-participant rows */}
            <View>
              <View style={styles.participantRow}>
                <Text style={styles.participantName}>You</Text>
                {splitMethod === 'equal' && (
                  <Text style={styles.participantValueReadOnly}>
                    {formatCurrency(yourShare, currencyCode)}
                  </Text>
                )}
                {splitMethod === 'percent' && (
                  <View style={styles.participantInputRow}>
                    <TextInput
                      style={styles.participantInput}
                      value={splitPercents.self ?? ''}
                      onChangeText={(v) =>
                        setSplitPercents((prev) => ({ ...prev, self: v }))
                      }
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={theme.colors.textMuted}
                    />
                    <Text style={styles.participantComputed}>
                      {formatCurrency((parseFloat(splitPercents.self || '0') || 0) / 100 * totalAmountVal, currencyCode)}
                    </Text>
                  </View>
                )}
                {splitMethod === 'amount' && (
                  <TextInput
                    style={styles.participantInput}
                    value={splitAmounts.self ?? ''}
                    onChangeText={(v) =>
                      setSplitAmounts((prev) => ({ ...prev, self: v }))
                    }
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                )}
              </View>

              {selectedOthers.map((m) => {
                const label = memberLabel(m);
                return (
                  <View key={m.uid} style={styles.participantRow}>
                    <Text style={styles.participantName} numberOfLines={1}>{label}</Text>
                    {splitMethod === 'equal' && (
                      <Text style={styles.participantValueReadOnly}>
                        {formatCurrency(yourShare, currencyCode)}
                      </Text>
                    )}
                    {splitMethod === 'percent' && (
                      <View style={styles.participantInputRow}>
                        <TextInput
                          style={styles.participantInput}
                          value={splitPercents[m.uid] ?? ''}
                          onChangeText={(v) =>
                            setSplitPercents((prev) => ({ ...prev, [m.uid]: v }))
                          }
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={theme.colors.textMuted}
                        />
                        <Text style={styles.participantComputed}>
                          {formatCurrency((parseFloat(splitPercents[m.uid] || '0') || 0) / 100 * totalAmountVal, currencyCode)}
                        </Text>
                      </View>
                    )}
                    {splitMethod === 'amount' && (
                      <TextInput
                        style={styles.participantInput}
                        value={splitAmounts[m.uid] ?? ''}
                        onChangeText={(v) =>
                          setSplitAmounts((prev) => ({ ...prev, [m.uid]: v }))
                        }
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={theme.colors.textMuted}
                      />
                    )}
                  </View>
                );
              })}
            </View>

            {splitWarning && <Text style={styles.splitWarning}>{splitWarning}</Text>}

            <Text style={styles.splitSummary}>
              You paid {formatCurrency(totalAmountVal, currencyCode)} ·{' '}
              {formatCurrency(owedToYou, currencyCode)} owed to you
            </Text>
          </View>
        )}
      </Card>

      {/* Notes */}
      <Card style={styles.fieldCard}>
        <Text style={styles.sectionLabel}>NOTES</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline, styles.notesText]}
          value={notes}
          onChangeText={setNotes}
          placeholder="No notes added."
          placeholderTextColor={theme.colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </Card>

      {/* Actions. "Save Changes" isn't in the design export's bottom
          section (which only shows Delete) but removing it would
          regress the ability to persist any edits made above, so it
          stays — placed above the spec'd outlined Delete button. */}
      <Button
        label="Save Changes"
        onPress={handleSave}
        loading={saving}
        size="lg"
        style={styles.saveBtn}
      />

      <Pressable onPress={handleDelete} style={styles.deleteBtnOutlined}>
        <Text style={styles.deleteBtnOutlinedText}>Delete expense</Text>
      </Pressable>
    </ScrollView>
    </View>
  );
}
