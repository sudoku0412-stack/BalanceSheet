import React, { useState, useEffect, useCallback } from 'react';
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
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import {
  getReceiptById,
  updateReceipt,
  deleteReceipt,
  getAllReceipts,
  getCurrentHouseholdId,
  getReceiptsByMonth,
} from '../../lib/database';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { useAuth } from '../../lib/AuthContext';
import { findRecurring } from '../../lib/reports';
import { parseYmdLocal } from '../../lib/parser';
import { notifySuccess, tapLight, tapMedium } from '../../lib/haptics';
import { notifyHouseholdOfBudgetStatus, notifyNewSharedExpense } from '../../lib/notifications';
import {
  formatCurrency,
  convertFromUsd,
  convertToUsd,
  CURRENCY_SYMBOLS,
  CURRENCIES,
  CurrencyCode,
} from '../../lib/currency';
import { getCurrency } from '../../lib/secureStorage';
import { advance as advanceRecurringDate, computeRecurringEndDate } from '../../lib/recurring';
import { Receipt, Category, LineItem } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES } from '../../constants/categories';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CategoryTagsPicker } from '../../components/ui/CategoryTagsPicker';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { SplitSection } from '../../components/ui/SplitSection';
import { PaidBySection } from '../../components/ui/PaidBySection';
import { DateField } from '../../components/ui/DateField';
import { sanitizeAmountInput, parseAmountInput } from '../../lib/amountValidation';

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
  const { user, profile, setEditInProgress } = useAuth();

  // Gates the household switcher (app/households.tsx) for the whole
  // time this screen is open — unlike the Scan tab (always mounted,
  // only sometimes mid-entry), this route only exists while editing one
  // specific receipt, so mount/unmount is exactly "unsaved edit in
  // progress."
  useEffect(() => {
    setEditInProgress(true);
    return () => setEditInProgress(false);
  }, [setEditInProgress]);
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
    currencyPickerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: t.spacing.xs,
      marginBottom: t.spacing.sm,
    },
    currencyPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: t.radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    currencyPillActive: {
      backgroundColor: t.colors.primary,
      borderColor: t.isDark ? t.colors.borderLight : t.colors.primary,
    },
    currencyPillText: {
      fontSize: t.font.xs,
      fontWeight: '700',
      fontFamily: t.fonts.body.medium,
      color: t.colors.textSecondary,
    },
    currencyPillTextActive: {
      color: '#fff',
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
    // Invite hint shown in the receipt-level split picker when the
    // household is solo (no other members yet) — same copy/style as
    // app/(tabs)/scan.tsx's per-item split-picker hint, for visual
    // consistency between the two screens.
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
    // ── Line items (view/add/edit/remove) — mirrors app/(tabs)/scan.tsx's
    // manual "Add Expense" items UI so an already-saved receipt gets the
    // same per-item name/amount/category/split-with management. ──
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    itemRowTouchable: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      gap: 10,
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
    },
    itemSplitLabel: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
    },
    itemAmount: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontFamily: t.fonts.mono.regular,
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
      color: t.colors.accent,
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    // Category chips — same tappable colored-chip pattern as
    // app/(tabs)/scan.tsx, used only inside the item add/edit modal
    // (the receipt-level category field uses CategoryTagsPicker instead).
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
    },
    // Item add/edit modal — centered card, same visual language as
    // app/(tabs)/scan.tsx's item modal.
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
  // Who fronted the money (Receipt.paidBy) — 'self' in the UI, resolved
  // to the signed-in user's real uid at save time (lib/balances.ts needs
  // a real uid, not the 'self' placeholder split.participantIds uses).
  // Defaults to 'self' (the receipt's own creator) until loaded.
  const [paidBy, setPaidBy] = useState<string>('self');

  // Paid-by is independent of the split participant selection (you can
  // say "my roommate paid" without splitting the expense with them at
  // all) — only reset if the chosen payer isn't even a household
  // member anymore (e.g. they left).
  useEffect(() => {
    if (paidBy !== 'self' && !(householdMembers ?? []).some((m) => m.uid === paidBy)) {
      setPaidBy('self');
    }
  }, [paidBy, householdMembers]);

  // ── Recurring expense ──
  // Mirrors Receipt.recurring (types/index.ts). Initialized from
  // receipt.recurring on load (see the load effect below). `originalRecurring`
  // tracks the persisted config so handleSave can tell "already recurring,
  // preserve nextDueDate" apart from "just turned on here, start fresh from
  // this receipt's own date" — resetting nextDueDate on every save would
  // make already-generated occurrences repeat.
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<
    'weekly' | 'biweekly' | 'monthly' | 'yearly'
  >('monthly');
  const [recurringDuration, setRecurringDuration] = useState('');
  const [originalRecurring, setOriginalRecurring] = useState<Receipt['recurring'] | undefined>(
    undefined,
  );
  // User-editable next-auto-add date — initialized from the persisted
  // schedule if already recurring, otherwise auto-filled (see the effect
  // below) so turning the toggle on doesn't silently lock to "one period
  // after today."
  const [recurringNextDate, setRecurringNextDate] = useState('');
  const [recurringNextDateTouched, setRecurringNextDateTouched] = useState(false);

  useEffect(() => {
    if (!recurringEnabled || recurringNextDateTouched || originalRecurring) return;
    const receiptDateYmd = parseYmdLocal(date) ? date : format(new Date(), 'yyyy-MM-dd');
    setRecurringNextDate(advanceRecurringDate(receiptDateYmd, recurringFrequency));
  }, [recurringEnabled, recurringFrequency, recurringNextDateTouched, originalRecurring, date]);

  // ── Line items (view/add/edit/remove) ──
  // Mirrors app/(tabs)/scan.tsx's manual "Add Expense" items UI so a
  // saved receipt gets the same per-item name/amount/category/split-with
  // management. Initialized from receipt.lineItems on load (see the load
  // effect below) and written back into the Receipt on save.
  const [items, setItems] = useState<LineItem[]>([]);
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

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    (async () => {
      // Fetch currency HERE (not just the separate effect below) so the
      // Amount field's initial display converts USD-canonical ->
      // selected currency using the value that's actually current at
      // load time, instead of racing the other effect and briefly (or
      // permanently, if that effect hasn't resolved yet) showing the
      // raw unconverted USD number.
      const [r, rawCurrency] = await Promise.all([getReceiptById(id), getCurrency()]);
      const profileCurrency = toCurrencyCode(rawCurrency);
      if (!mounted || !r) {
        if (mounted) setLoading(false);
        return;
      }
      // Default to whatever currency THIS receipt was actually entered
      // in, not the profile currency — a receipt genuinely paid in USD
      // should still show/edit as USD even if the profile is now CAD.
      // Legacy receipts with nothing recorded fall back to profile.
      const loadCurrency = r.originalCurrency ?? profileCurrency;
      setCurrencyCode(loadCurrency);
      setReceipt(r);
      setStoreName(r.storeName);
      setDate(safeFormat(r.date, 'yyyy-MM-dd'));
      setAmount(safeAmount(convertFromUsd(r.totalAmount, loadCurrency)));
      setCategory(r.category);
      setCategoryTags(r.categoryTags ?? [r.category]);
      setNotes(r.notes ?? '');
      setItems(r.lineItems ?? []);

      // Initialize split UI state from the persisted split field, if any.
      if (r.split?.enabled) {
        setSplitEnabled(true);
        setSplitMethod(r.split.method);
        // Participant ids may be the literal 'self' placeholder (legacy
        // receipts, or ones last saved by THIS device) or a real uid
        // (receipts saved under the newer scheme, or ones created by a
        // DIFFERENT household member's device) — either way, "self" for
        // THIS load means whoever is currently signed in.
        const others = r.split.participantIds.filter(
          (p) => p !== 'self' && p !== user?.uid,
        );
        setSelectedOtherUids(new Set(others));
        // Normalize keys the same way — a real-uid key matching the
        // current viewer maps back to the 'self' placeholder this UI's
        // Records are keyed by everywhere else.
        const normalizeKey = (k: string) => (k === 'self' || k === user?.uid ? 'self' : k);
        if (r.split.method === 'percent') {
          const pct: Record<string, string> = {};
          for (const [k, v] of Object.entries(r.split.values ?? {})) {
            pct[normalizeKey(k)] = String(v);
          }
          setSplitPercents(pct);
        } else if (r.split.method === 'amount') {
          const amt: Record<string, string> = {};
          for (const [k, v] of Object.entries(r.split.values ?? {})) {
            amt[normalizeKey(k)] = String(v);
          }
          setSplitAmounts(amt);
        }
      }
      // r.paidBy is a real uid ('self' is never persisted there) — map
      // it back to the 'self' UI placeholder when it matches the signed-
      // in user, so the "You" pill highlights correctly.
      if (r.paidBy && r.paidBy !== user?.uid) {
        setPaidBy(r.paidBy);
      } else {
        setPaidBy('self');
      }

      // Initialize recurring UI state from the persisted recurring
      // field, if any. Duration (months) can't be perfectly reverse-
      // derived from nextDueDate/endDate alone, so it's left blank —
      // only the toggle + frequency load from what's actually persisted.
      if (r.recurring) {
        setRecurringEnabled(true);
        setRecurringFrequency(r.recurring.frequency);
        setOriginalRecurring(r.recurring);
        setRecurringNextDate(r.recurring.nextDueDate);
        setRecurringNextDateTouched(true);
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

  // currencyCode is now initialized inside the receipt-load effect
  // above (defaults to the receipt's own originalCurrency, falling
  // back to the profile currency) — no separate fetch needed here,
  // and one would just clobber that receipt-aware default back to
  // the plain profile currency once it resolved.

  // Real household members (lib/cloudSync.getHouseholdMembers), mirroring
  // the FamilyPanel fetch pattern in app/settings.tsx. Used as the split
  // participant list — no fictional demo names.
  //
  // Refetched on screen FOCUS (useFocusEffect), not just on mount: if the
  // user invites/accepts a household member on another screen and then
  // navigates back here, a mount-only effect would leave the participant
  // list stale until a full app restart. Matches the useFocusEffect(
  // useCallback(...)) pattern already used by app/(tabs)/index.tsx,
  // app/(tabs)/history.tsx, and app/reports.tsx.
  const loadHouseholdMembers = useCallback(async () => {
    if (!user?.uid) {
      setHouseholdMembers([]);
      return;
    }
    const hid = getCurrentHouseholdId();
    if (!hid) {
      setHouseholdMembers([]);
      return;
    }
    const list = await getHouseholdMembers({ householdId: hid, currentUid: user.uid });
    setHouseholdMembers(list ?? []);
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      loadHouseholdMembers();
    }, [loadHouseholdMembers]),
  );

  const handleSave = async () => {
    if (!receipt) return;
    if (!storeName.trim()) {
      Alert.alert('Missing field', 'Please enter a store name.');
      return;
    }
    const amountVal = parseAmountInput(amount);
    if (amountVal === null || amountVal < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount.');
      return;
    }

    // Parse the user-typed YYYY-MM-DD as LOCAL time so the wall-clock
    // date the user sees survives the save → reload round-trip.
    const parsedDate: Date = parseYmdLocal(date) ?? new Date(receipt.date);

    // Recurring duration: required only when the toggle is being turned
    // on for the first time here (no persisted config to fall back on).
    // If it was already recurring, an entered duration just recomputes
    // endDate from today's edit — leaving it blank keeps the existing
    // endDate untouched.
    const durationTrimmed = recurringDuration.trim();
    const recurringDurationVal = parseInt(durationTrimmed, 10);
    const validDuration =
      !!durationTrimmed &&
      !isNaN(recurringDurationVal) &&
      recurringDurationVal > 0 &&
      String(recurringDurationVal) === durationTrimmed;
    if (recurringEnabled && !originalRecurring && !validDuration) {
      Alert.alert(
        'Missing duration',
        'Please enter how many months this expense should repeat for.',
      );
      return;
    }
    if (recurringEnabled && !parseYmdLocal(recurringNextDate.trim())) {
      Alert.alert('Invalid date', 'Please enter a valid next auto-add date (YYYY-MM-DD).');
      return;
    }

    setSaving(true);
    try {
      // Derive primary category from the tag list — first standard
      // category found, fall back to existing primary if all tags
      // are custom strings.
      const primary: Category =
        (categoryTags.find((t) =>
          (ALL_CATEGORIES as readonly string[]).includes(t),
        ) as Category | undefined) ?? category;

      // Build the split payload from the current split UI state — this
      // now actually persists (Receipt.split, types/index.ts). Store the
      // signed-in user's REAL uid instead of the 'self' UI placeholder
      // — 'self' only ever meant "whoever is looking at this screen
      // right now," which resolves to the WRONG person if a different
      // household member opens this same receipt on their own device
      // (their balances would silently show nothing for it — a real bug
      // this exact substitution fixes). Mirrors how `paidBy` below
      // already does this.
      const selfUidForSave = user?.uid ?? 'self';
      const normalizeForSave = (id: string) => (id === 'self' ? selfUidForSave : id);
      const split: Receipt['split'] = splitEnabled
        ? {
            enabled: true,
            method: splitMethod,
            participantIds: [selfUidForSave, ...Array.from(selectedOtherUids)],
            values:
              splitMethod === 'percent'
                ? Object.fromEntries(
                    Object.entries(splitPercents).map(([k, v]) => [
                      normalizeForSave(k),
                      parseFloat(v) || 0,
                    ]),
                  )
                : splitMethod === 'amount'
                  ? Object.fromEntries(
                      Object.entries(splitAmounts).map(([k, v]) => [
                        normalizeForSave(k),
                        parseFloat(v) || 0,
                      ]),
                    )
                  : undefined,
          }
        : { enabled: false, method: splitMethod, participantIds: [selfUidForSave] };

      // Build/update the recurring payload. nextDueDate is now the
      // user-editable `recurringNextDate` (validated above) instead of
      // always silently defaulting to one period after the receipt's
      // own date. endDate is recomputed only when a new duration was
      // entered; otherwise the already-recurring receipt's endDate is
      // preserved so occurrences already generated by lib/recurring.ts
      // don't repeat.
      const receiptDateYmd = format(parsedDate, 'yyyy-MM-dd');
      const recurring: Receipt['recurring'] | undefined = recurringEnabled
        ? {
            frequency: recurringFrequency,
            nextDueDate: format(parseYmdLocal(recurringNextDate.trim())!, 'yyyy-MM-dd'),
            endDate:
              originalRecurring && !validDuration
                ? originalRecurring.endDate
                : computeRecurringEndDate(receiptDateYmd, recurringDurationVal),
          }
        : undefined;

      await updateReceipt({
        ...receipt,
        storeName: storeName.trim(),
        date: parsedDate.toISOString(),
        // amountVal is what the user typed, in the currently SELECTED
        // display currency — convert to USD-canonical before persisting
        // (matches how it's loaded/edited above; see totalAmountVal's
        // comment for the bug this fixes).
        totalAmount: convertToUsd(amountVal, currencyCode),
        originalCurrency: currencyCode,
        category: primary,
        categoryTags: categoryTags.length ? categoryTags : [primary],
        notes: notes.trim() || undefined,
        split,
        lineItems: items,
        recurring,
        // paidBy needs a real uid so every household member's device
        // resolves the same payer — 'self' is only ever a UI placeholder
        // (see lib/balances.ts).
        paidBy: paidBy === 'self' ? user?.uid : paidBy,
      });

      // Household activity push (fire-and-forget) — same triggers as
      // app/(tabs)/scan.tsx's manual add, so editing an amount/split
      // after the fact still reaches other members promptly.
      const householdId = getCurrentHouseholdId();
      if (householdId && user?.uid) {
        getReceiptsByMonth(parsedDate.getFullYear(), parsedDate.getMonth() + 1)
          .then((monthReceipts) =>
            notifyHouseholdOfBudgetStatus({ householdId, selfUid: user.uid, monthReceipts }),
          )
          .catch(() => {});
      }
      if (split?.enabled) {
        const otherParticipantUids = split.participantIds.filter((pid) => pid !== selfUidForSave);
        if (otherParticipantUids.length > 0) {
          const payerLabel = profile
            ? `${profile.firstName} ${profile.lastName}`.trim()
            : user?.displayName || 'Someone';
          void notifyNewSharedExpense({
            participantUids: otherParticipantUids,
            payerLabel,
            amountLabel: formatCurrency(convertToUsd(amountVal, currencyCode), currencyCode),
            storeName: storeName.trim(),
          });
        }
      }

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
        {/* NOT theme.colors.primary — dark navy on the dark-mode
            background is invisible; accent has real contrast in both themes. */}
        <ActivityIndicator size="large" color={theme.colors.accent} />
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

  // ── Split math ── the Amount field displays/accepts numbers in the
  // user's SELECTED currency (it's converted on load, see the receipt
  // effect above), but every other amount in this codebase — line
  // items, split values, formatCurrency's own input — is USD-canonical.
  // Converting back here once means every downstream calculation stays
  // in that same canonical unit; skipping this was the root cause of
  // "entered a CAD amount, got double-converted" (the raw typed number
  // was being treated as already-USD, then formatCurrency multiplied
  // it by the CAD rate AGAIN when displaying it elsewhere).
  const totalAmountVal = convertToUsd(parseFloat(amount.replace(',', '.')) || 0, currencyCode);
  const otherMembers = (householdMembers ?? []).filter((m) => !m.isYou);

  // Haptic feedback lives in SplitSection itself (single source, since
  // scan.tsx's manual-add flow uses the same component) — this just
  // updates state.
  const toggleOtherParticipant = (uid: string) => {
    const next = new Set(selectedOtherUids);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    setSelectedOtherUids(next);
  };

  // ── Line-item add/edit/remove handlers ──
  // 'self' + every other household member — the full set of ids a line
  // item can be split across. Reuses this screen's existing
  // householdMembers fetch rather than re-fetching.
  const participantIds = ['self', ...otherMembers.map((m) => m.uid)];

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
    // item.amount is USD-canonical (same as the receipt total) — show
    // it converted to the selected display currency, matching the
    // top-level Amount field's treatment.
    setItemAmount(item.amount ? String(convertFromUsd(item.amount, currencyCode)) : '');
    setItemCategory(((item.category as Category) || 'Other') as Category);
    // An item that already has an explicit (proper-subset) splitWith was
    // deliberately customized before — honor it as "touched" so re-saving
    // without changes doesn't silently widen it back to everyone.
    const hasExplicitSplit = !!item.splitWith && item.splitWith.length > 0;
    // Reverse of the save-time substitution — a real uid matching the
    // current viewer reads back as the 'self' placeholder the "You"
    // toggle checks against.
    const normalizedSplitWith = item.splitWith?.map((id) =>
      id === user?.uid ? 'self' : id,
    );
    setItemSplit(
      hasExplicitSplit ? new Set(normalizedSplitWith) : new Set(participantIds),
    );
    setItemSplitTouched(hasExplicitSplit);
    setItemModalVisible(true);
  };

  const closeItemModal = () => setItemModalVisible(false);

  const toggleItemSplit = (uid: string) => {
    setItemSplitTouched(true);
    setItemSplit((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const saveItemModal = () => {
    const trimmedName = itemName.trim();
    if (!trimmedName) {
      Alert.alert('Missing name', 'Please enter an item name.');
      return;
    }
    const amt = parseAmountInput(itemAmount);
    if (amt === null || amt < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid item amount.');
      return;
    }
    // Solo household (no other members) — nothing to split, so this
    // item's splitWith always stays undefined regardless of the (not
    // rendered) picker state. Same "everyone selected → undefined"
    // shorthand as app/(tabs)/scan.tsx.
    //
    // "Untouched" also counts as shared-by-everyone REGARDLESS of what
    // itemSplit happens to contain — household members load async, so
    // itemSplit may have been seeded from a stale/incomplete participant
    // list (see itemSplitTouched's declaration for the full race). Only
    // an itemSplit the user actually edited is trusted as an intentional
    // subset.
    const sharedByEveryone =
      otherMembers.length === 0 ||
      !itemSplitTouched ||
      itemSplit.size >= participantIds.length;
    const newItem: LineItem = {
      id: editingItemId ?? uuidv4(),
      name: trimmedName,
      amount: convertToUsd(amt, currencyCode),
      category: itemCategory,
      // Same 'self' -> real-uid substitution as the receipt-level split
      // above (handleSave) — otherwise a different household member
      // opening this receipt can't correctly resolve who this item is
      // shared with.
      splitWith: sharedByEveryone
        ? undefined
        : Array.from(itemSplit).map((id) => (id === 'self' ? user?.uid ?? 'self' : id)),
    };
    // Keep the receipt total in lockstep with the items that make it
    // up — adding/editing/removing a line item adjusts Amount by the
    // same delta instead of leaving it stale. `newItem.amount`/removed
    // items are USD-canonical, `amount` (the displayed total) is in
    // the receipt's own currency, so the delta has to cross that
    // conversion too.
    const oldAmountUsd = editingItemId ? items.find((it) => it.id === editingItemId)?.amount ?? 0 : 0;
    const deltaUsd = newItem.amount - oldAmountUsd;
    setItems((prev) =>
      editingItemId
        ? prev.map((it) => (it.id === editingItemId ? newItem : it))
        : [...prev, newItem],
    );
    if (deltaUsd !== 0) {
      const deltaDisplay = convertFromUsd(deltaUsd, currencyCode);
      setAmount((prev) => Math.max(0, (parseAmountInput(prev) ?? 0) + deltaDisplay).toFixed(2));
    }
    setItemModalVisible(false);
  };

  const removeItem = (itemId: string) => {
    const removed = items.find((it) => it.id === itemId);
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    if (removed) {
      const deltaDisplay = convertFromUsd(removed.amount, currencyCode);
      setAmount((prev) => Math.max(0, (parseAmountInput(prev) ?? 0) - deltaDisplay).toFixed(2));
    }
  };

  // "Split with N people" / "You only" summary shown on each item row.
  const splitSummaryLabel = (item: LineItem): string => {
    if (otherMembers.length === 0) return 'You only';
    const resolvedCount =
      item.splitWith && item.splitWith.length
        ? item.splitWith.length
        : participantIds.length;
    if (resolvedCount <= 1) return 'You only';
    return `Split with ${resolvedCount} people`;
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
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
          onChangeText={(text) => setAmount(sanitizeAmountInput(text))}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.colors.textMuted}
        />
      </View>

      {/* Per-receipt currency — defaults to whatever this receipt was
          originally entered in (or the profile currency for a legacy
          receipt with none recorded), overridable here. Switching it
          does NOT recompute the typed Amount digits — it just relabels
          what unit they're in (e.g. "I typed 57.09 thinking CAD, but
          this was actually paid in USD"). Saving converts to USD-
          canonical using WHICHEVER currency is selected here. */}
      <View style={styles.currencyPickerRow}>
        {CURRENCIES.map((code) => {
          const active = code === currencyCode;
          return (
            <TouchableOpacity
              key={code}
              onPress={() => setCurrencyCode(code)}
              activeOpacity={0.7}
              style={[styles.currencyPill, active && styles.currencyPillActive]}
            >
              <Text style={[styles.currencyPillText, active && styles.currencyPillTextActive]}>
                {code}
              </Text>
            </TouchableOpacity>
          );
        })}
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

      {/* Recurring — mirrors Receipt.recurring (types/index.ts). Turning
          this on starts (or continues) lib/recurring.ts's auto-generation
          of future occurrences; turning it off (recurring: undefined on
          save) stops it. */}
      <Card style={styles.fieldCard}>
        <Text style={styles.sectionLabel}>RECURRING</Text>
        <View style={styles.splitToggleRow}>
          <Text style={styles.splitToggleLabel}>Repeat this expense</Text>
          <Switch
            value={recurringEnabled}
            onValueChange={setRecurringEnabled}
            trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
          />
        </View>

        {recurringEnabled && (
          <View style={styles.splitBody}>
            <View style={styles.segmented}>
              {(['weekly', 'biweekly', 'monthly', 'yearly'] as const).map((freq) => {
                const active = recurringFrequency === freq;
                const label =
                  freq === 'weekly'
                    ? 'Weekly'
                    : freq === 'biweekly'
                      ? 'Bi-weekly'
                      : freq === 'monthly'
                        ? 'Monthly'
                        : 'Yearly';
                return (
                  <Pressable
                    key={freq}
                    style={[
                      styles.segmentedTab,
                      active && { backgroundColor: theme.colors.accent },
                    ]}
                    onPress={() => setRecurringFrequency(freq)}
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

            <Text style={styles.fieldLabel}>Next auto-add date</Text>
            <DateField
              value={recurringNextDate}
              onChange={(v) => {
                setRecurringNextDateTouched(true);
                setRecurringNextDate(v);
              }}
              placeholder="Select date"
            />

            <Text style={styles.fieldLabel}>For how many months</Text>
            <TextInput
              style={styles.input}
              value={recurringDuration}
              onChangeText={setRecurringDuration}
              placeholder="12"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="numeric"
            />
          </View>
        )}
      </Card>

      {/* Items — view/add/edit/remove line items, same UX as Add Expense
          (app/(tabs)/scan.tsx). Each item can carry its own splitWith,
          which the Split section below factors into the per-person math
          (see usesPerItemSplit / lineItemsForSplit above). */}
      <Card style={styles.fieldCard}>
        <Text style={styles.sectionLabel}>
          ITEMS{items.length ? ` (${items.length})` : ''}
        </Text>
        {items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <TouchableOpacity
              style={styles.itemRowTouchable}
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
              <Text style={styles.itemAmount}>
                {formatCurrency(item.amount, currencyCode)}
              </Text>
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
                style={styles.input}
                value={itemAmount}
                onChangeText={(text) => setItemAmount(sanitizeAmountInput(text))}
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

      <PaidBySection otherMembers={otherMembers} paidBy={paidBy} onPaidByChange={setPaidBy} />

      <SplitSection
        otherMembers={otherMembers}
        enabled={splitEnabled}
        onEnabledChange={setSplitEnabled}
        method={splitMethod}
        onMethodChange={setSplitMethod}
        selectedOtherUids={selectedOtherUids}
        onToggleParticipant={toggleOtherParticipant}
        splitPercents={splitPercents}
        onChangePercent={(key, v) => setSplitPercents((prev) => ({ ...prev, [key]: v }))}
        splitAmounts={splitAmounts}
        onChangeAmount={(key, v) => setSplitAmounts((prev) => ({ ...prev, [key]: v }))}
        totalAmountUsd={totalAmountVal}
        currencyCode={currencyCode}
        lineItems={items}
      />

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
    </SafeAreaView>
  );
}
