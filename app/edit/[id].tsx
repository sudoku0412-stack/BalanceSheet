import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
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
  replaceLineItems,
  getCurrentHouseholdId,
} from '../../lib/database';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { useAuth } from '../../lib/AuthContext';
import { refineUncategorizedItems } from '../../lib/itemClassifier';
import { checkItemsAgainstSubtotal } from '../../lib/itemsTotalCheck';
import { parseYmdLocal } from '../../lib/parser';
import { notifySuccess, tapLight, tapMedium } from '../../lib/haptics';
import { Receipt, Category, LineItem } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES, CATEGORY_ICONS } from '../../constants/categories';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CategoryTagsPicker } from '../../components/ui/CategoryTagsPicker';
import { TagChip } from '../../components/ui/TagChip';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { ItemEditModal } from '../../components/receipt/ItemEditModal';

type CategoryGroup = {
  category: Category | string;
  items: LineItem[];
  subtotal: number;
};

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

function groupItemsByCategory(
  items: LineItem[],
  receiptCategory: Category,
): CategoryGroup[] {
  const map = new Map<string, LineItem[]>();
  for (const item of items) {
    // Older items written before per-item categorization fall back to the
    // receipt-level category so they still group sensibly.
    const c = (item.category ?? receiptCategory) as string;
    const list = map.get(c);
    if (list) list.push(item);
    else map.set(c, [item]);
  }
  return Array.from(map.entries())
    .map(([category, list]) => ({
      category,
      items: list,
      subtotal: list.reduce((s, i) => s + i.amount, 0),
    }))
    .sort((a, b) => b.subtotal - a.subtotal);
}

/** A split participant: "You" (always present, not removable) plus any
 *  real household members pulled from lib/cloudSync.getHouseholdMembers.
 *  There is no fictional "Partner / Alex / Priya" demo list here — if
 *  the household has no other members (solo household, or cloud sync
 *  not bootstrapped yet), the picker simply shows just "You". */
type SplitParticipant = {
  key: string;
  label: string;
  isYou: boolean;
};

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
    // ── Category row: colored dot + primary category name ──
    // No "Recurring" pill is rendered here — Receipt (types/index.ts)
    // has no recurring field anywhere in this codebase, so it's omitted
    // rather than faked. The full multi-tag picker below it is the
    // pre-existing categorization feature, kept intact.
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
    lineItemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 5,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    lineItemName: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      flex: 1,
      marginRight: 8,
    },
    lineItemAmount: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    categoryGroup: {
      marginTop: t.spacing.sm,
    },
    categoryGroupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 6,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.borderLight,
    },
    categoryGroupTotal: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    totalsBlock: {
      marginTop: t.spacing.md,
      paddingTop: t.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: t.colors.borderLight,
    },
    totalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    totalsRowGrand: {
      marginTop: t.spacing.xs,
      paddingTop: t.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
    },
    totalsLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
    },
    totalsValue: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    totalsLabelGrand: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '700',
    },
    totalsValueGrand: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.primary,
      fontSize: t.font.lg,
      fontWeight: '800',
    },
    modalRoot: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    modalTitle: {
      color: t.colors.textPrimary,
      fontSize: t.font.lg,
      fontWeight: '700',
    },
    modalScroll: {
      flex: 1,
    },
    modalContent: {
      padding: t.spacing.lg,
    },
    modalText: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontFamily: t.fonts.mono.regular,
      lineHeight: 18,
    },
    rawTextLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: t.spacing.sm,
      paddingVertical: 8,
    },
    rawTextLinkText: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '600',
    },
    itemsCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    tapHint: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
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
    lineItemRowSelected: {
      backgroundColor: `${t.colors.primary}1A`,
      borderRadius: t.radius.sm,
    },
    bulkBar: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.md,
      paddingBottom: t.spacing.lg,
      backgroundColor: t.colors.surface,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
    },
    bulkBarLabel: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    bulkBarPrimary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: t.colors.primary,
      paddingHorizontal: t.spacing.md,
      paddingVertical: 10,
      borderRadius: t.radius.lg,
    },
    bulkBarPrimaryText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: t.font.sm,
    },
    bulkPickerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    bulkPickerSheet: {
      backgroundColor: t.colors.surface,
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.lg,
      paddingBottom: t.spacing.xxl,
      borderTopLeftRadius: t.radius.lg,
      borderTopRightRadius: t.radius.lg,
    },
    bulkPickerTitle: {
      color: t.colors.textPrimary,
      fontSize: t.font.lg,
      fontWeight: '700',
      marginBottom: t.spacing.md,
    },
    bulkPickerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    bulkPickerOption: {
      // TagChip handles its own padding; no wrapper styling needed
    },
    bulkPickerCustomLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginTop: t.spacing.lg,
      marginBottom: t.spacing.xs,
    },
    bulkPickerCustomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    bulkPickerCustomInput: {
      flex: 1,
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    bulkPickerCustomBtn: {
      backgroundColor: t.colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderRadius: t.radius.sm,
    },
    bulkPickerCustomBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: t.font.sm,
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
    splitGap: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontStyle: 'italic',
      marginTop: t.spacing.xs,
    },
  }));
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRawText, setShowRawText] = useState(false);

  const [storeName, setStoreName] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [categoryTags, setCategoryTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);
  const [editingItem, setEditingItem] = useState<LineItem | null>(null);
  // Multi-select mode for bulk recategorization. When set is empty
  // we render the normal "tap to edit" UI; once at least one item is
  // selected, taps toggle selection and a bottom action bar appears.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkCategoryPicker, setShowBulkCategoryPicker] = useState(false);
  // True once the <Image> reports it couldn't load — likely a stale
  // cache URI from a receipt scanned before persistReceiptImage was
  // introduced. We hide the broken image area instead of rendering
  // an empty blank space.
  const [imageMissing, setImageMissing] = useState(false);
  // Track the custom-tag input shown inside the bulk picker so users
  // can add a brand new tag (e.g. "Garden Supplies") without leaving
  // the sheet. Submitting applies the tag immediately AND adds it to
  // the receipt-level categoryTags list via applyBulkCategory.
  // CRITICAL: this useState MUST live with the other hooks at the top
  // of the component, NOT after the early returns below. React will
  // throw "Rendered more hooks than during the previous render" if
  // any hook is conditionally called.
  const [bulkCustomTag, setBulkCustomTag] = useState('');
  const selectionMode = selectedIds.size > 0;

  // ── Split-this-expense state (local-only) ──
  // There is no `split` field on Receipt (types/index.ts) and no
  // split/shared-expense backend anywhere in this codebase (grepped
  // for "split" — only String.prototype.split() call sites turned
  // up). The math below is real and runs against real household
  // members, but it is NOT persisted anywhere: it resets if the user
  // leaves this screen and comes back. Persisting it would require
  // adding a `split` field to the Receipt type (types/index.ts) and a
  // write path in lib/database.ts / lib/cloudSync.ts — both out of
  // scope for a pass restricted to this one file. Flagging the gap
  // rather than inventing storage for it.
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitMethod, setSplitMethod] = useState<'equal' | 'percent' | 'amount'>('equal');
  const [selectedOtherUids, setSelectedOtherUids] = useState<Set<string>>(new Set());
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
      setItems(r.lineItems ?? []);
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

      // Background refinement — run the async classifier on items still
      // marked 'Other'. Updates land in the DB; refresh local state on
      // success so the UI re-renders the new category badges.
      if (r.lineItems?.length) {
        try {
          const refined = await refineUncategorizedItems(r.lineItems);
          if (mounted) {
            setReceipt({ ...r, lineItems: refined });
            setItems(refined);
          }
        } catch {
          // best-effort; ignore
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

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

    // Verify line items still sum to the printed subtotal — the user
    // may have edited / deleted items since the last save and the
    // result might no longer reconcile. Give them a chance to fix it
    // OR save anyway if they've already cross-verified.
    const mismatch = checkItemsAgainstSubtotal(items, receipt.subtotalAmount);
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
      await updateReceipt({
        ...receipt,
        storeName: storeName.trim(),
        date: parsedDate.toISOString(),
        totalAmount: amountVal,
        category: primary,
        categoryTags: categoryTags.length ? categoryTags : [primary],
        notes: notes.trim() || undefined,
        lineItems: items,
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

  const applyBulkCategory = (category: Category | string) => {
    if (!receipt || selectedIds.size === 0) return;
    tapLight();
    const next = items.map((it) =>
      selectedIds.has(it.id) ? { ...it, category } : it,
    );
    setItems(next);
    // Keep the receipt-level Categories field in sync — if the user
    // bulk-tags items as a category that isn't already in the chip
    // list, add it. This makes the items section and the Categories
    // section render the same set of tags.
    if (!categoryTags.includes(category)) {
      setCategoryTags([...categoryTags, category]);
    }
    setSelectedIds(new Set());
    setShowBulkCategoryPicker(false);
    replaceLineItems(receipt.id, next).catch(() => {
      Alert.alert(
        'Could not save',
        'The category changes were not persisted. Try again.',
      );
    });
  };

  const submitBulkCustomTag = () => {
    const trimmed = bulkCustomTag.trim().slice(0, 32);
    if (!trimmed) return;
    setBulkCustomTag('');
    applyBulkCategory(trimmed);
  };

  // ── Split math (local state only — see comment on the hooks above) ──
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
    const yourPct = parseFloat(splitPercents.you || '0') || 0;
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
    const yourAmt = parseFloat(splitAmounts.you || '0') || 0;
    const othersAmt = selectedOthers.reduce(
      (s, m) => s + (parseFloat(splitAmounts[m.uid] || '0') || 0),
      0,
    );
    const sumAmt = yourAmt + othersAmt;
    yourShare = yourAmt;
    owedToYou = othersAmt;
    if (Math.abs(sumAmt - totalAmountVal) > 0.01) {
      splitWarning = `Amounts add up to $${sumAmt.toFixed(2)}, not $${totalAmountVal.toFixed(2)}.`;
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
      contentContainerStyle={[
        styles.content,
        selectionMode && { paddingBottom: 100 },
      ]}
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

      {/* Amount — 32px, Roboto Mono per the Design Tokens section of
          the handoff. Still an editable field. */}
      <View style={styles.amountRow}>
        <Text style={styles.amountCurrency}>$</Text>
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

      {/* Category row — colored dot + primary category name, per the
          export. The full multi-tag picker (existing feature) stays
          right below it for actually changing categories/tags. */}
      <Card style={styles.fieldCard}>
        <View style={styles.categoryRow}>
          <View
            style={[
              styles.categoryDot,
              { backgroundColor: theme.colors.category[category] },
            ]}
          />
          <Text style={styles.categoryRowLabel}>{category}</Text>
        </View>
        <CategoryTagsPicker tags={categoryTags} onChange={setCategoryTags} />
      </Card>

      {/* Split section (Splitwise-style). Toggle reveals participant
          picker + Equal/%/$ method switch. See the hook-level comment
          above for what's real (the math, the household member list)
          vs. what's a known gap (no persistence field on Receipt). */}
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
                    ${yourShare.toFixed(2)}
                  </Text>
                )}
                {splitMethod === 'percent' && (
                  <View style={styles.participantInputRow}>
                    <TextInput
                      style={styles.participantInput}
                      value={splitPercents.you ?? ''}
                      onChangeText={(v) =>
                        setSplitPercents((prev) => ({ ...prev, you: v }))
                      }
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={theme.colors.textMuted}
                    />
                    <Text style={styles.participantComputed}>
                      ${((parseFloat(splitPercents.you || '0') || 0) / 100 * totalAmountVal).toFixed(2)}
                    </Text>
                  </View>
                )}
                {splitMethod === 'amount' && (
                  <TextInput
                    style={styles.participantInput}
                    value={splitAmounts.you ?? ''}
                    onChangeText={(v) =>
                      setSplitAmounts((prev) => ({ ...prev, you: v }))
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
                        ${yourShare.toFixed(2)}
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
                          ${((parseFloat(splitPercents[m.uid] || '0') || 0) / 100 * totalAmountVal).toFixed(2)}
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
              You paid ${totalAmountVal.toFixed(2)} · ${owedToYou.toFixed(2)} owed to you
            </Text>

            <Text style={styles.splitGap}>
              Not saved yet — splits aren't persisted on this receipt.
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

      {/* Line items grouped by category, with tax + total. Tap any
          row to fix name/amount/category or delete it. Long-press
          (or tap "Select") to enter multi-select mode, then tap rows
          to toggle and use the bottom bar to bulk-recategorize. */}
      {items.length > 0 && (
        <Card style={styles.fieldCard}>
          <View style={styles.itemsCardHeader}>
            <Text style={styles.fieldLabel}>
              {selectionMode
                ? `${selectedIds.size} selected`
                : `Items (${items.length})`}
            </Text>
            {selectionMode ? (
              <TouchableOpacity onPress={() => setSelectedIds(new Set())} hitSlop={8}>
                <Text style={[styles.tapHint, { color: theme.colors.primary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  if (items.length > 0) {
                    setSelectedIds(new Set([items[0].id]));
                  }
                }}
                hitSlop={8}
              >
                <Text style={[styles.tapHint, { color: theme.colors.primary }]}>
                  Select
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {groupItemsByCategory(items, receipt.category).map((group) => (
            <View key={group.category} style={styles.categoryGroup}>
              <View style={styles.categoryGroupHeader}>
                <TagChip tag={group.category} size="sm" />
                <Text style={styles.categoryGroupTotal}>
                  ${safeAmount(group.subtotal)}
                </Text>
              </View>
              {group.items.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => {
                      if (selectionMode) {
                        const next = new Set(selectedIds);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        setSelectedIds(next);
                      } else {
                        setEditingItem(item);
                      }
                    }}
                    onLongPress={() => {
                      const next = new Set(selectedIds);
                      next.add(item.id);
                      setSelectedIds(next);
                    }}
                    style={[
                      styles.lineItemRow,
                      isSelected && styles.lineItemRowSelected,
                    ]}
                    activeOpacity={0.7}
                  >
                    {selectionMode && (
                      <Ionicons
                        name={isSelected ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={
                          isSelected
                            ? theme.colors.primary
                            : theme.colors.textMuted
                        }
                        style={{ marginRight: 10 }}
                      />
                    )}
                    <Text style={styles.lineItemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.lineItemAmount}>
                      ${safeAmount(item.amount)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <View style={styles.totalsBlock}>
            {receipt.subtotalAmount != null && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Subtotal</Text>
                <Text style={styles.totalsValue}>
                  ${safeAmount(receipt.subtotalAmount)}
                </Text>
              </View>
            )}
            {receipt.taxAmount != null && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Tax</Text>
                <Text style={styles.totalsValue}>
                  ${safeAmount(receipt.taxAmount)}
                </Text>
              </View>
            )}
            <View style={[styles.totalsRow, styles.totalsRowGrand]}>
              <Text style={styles.totalsLabelGrand}>Total</Text>
              <Text style={styles.totalsValueGrand}>
                ${safeAmount(receipt.totalAmount)}
              </Text>
            </View>
          </View>
        </Card>
      )}

      {/* Raw OCR text — useful for debugging "why didn't the parser
          extract anything?". Opens a scrollable, share-friendly modal. */}
      {receipt.rawText && (
        <TouchableOpacity
          onPress={() => setShowRawText(true)}
          style={styles.rawTextLink}
        >
          <Ionicons
            name="document-text-outline"
            size={14}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.rawTextLinkText}>
            Show raw OCR text ({receipt.rawText.length} chars)
          </Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={showRawText}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRawText(false)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Raw OCR text</Text>
            <Pressable onPress={() => setShowRawText(false)} hitSlop={10}>
              <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <Text selectable style={styles.modalText}>
              {receipt.rawText ?? '(empty)'}
            </Text>
          </ScrollView>
        </View>
      </Modal>

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

      <ItemEditModal
        item={editingItem}
        extraTags={categoryTags}
        onAddCustomTag={(tag) => {
          // Sync newly-coined item-level tags into the receipt's
          // shared categoryTags list. This is what makes the new
          // tag available to other items on the same receipt and
          // keeps the per-receipt chip strip in agreement with the
          // per-item picker.
          setCategoryTags((prev) =>
            prev.some((t) => t.toLowerCase() === tag.toLowerCase())
              ? prev
              : [...prev, tag],
          );
        }}
        onClose={() => setEditingItem(null)}
        onSave={(updated) => {
          if (!receipt) return;
          const next = items.map((it) => (it.id === updated.id ? updated : it));
          setItems(next);
          // Persist immediately so the dashboard, history, and category
          // drilldown all reflect the new item category without forcing
          // the user to also tap "Save Changes" on the receipt header.
          replaceLineItems(receipt.id, next).catch(() => {
            Alert.alert('Could not save', 'The item change was not persisted. Try again.');
          });
          setEditingItem(null);
        }}
        onDelete={(id) => {
          if (!receipt) return;
          const next = items.filter((it) => it.id !== id);
          setItems(next);
          replaceLineItems(receipt.id, next).catch(() => {
            Alert.alert('Could not save', 'The item deletion was not persisted. Try again.');
          });
          setEditingItem(null);
        }}
      />
    </ScrollView>

    {selectionMode && (
      <View style={styles.bulkBar}>
        <Text style={styles.bulkBarLabel}>
          {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} selected
        </Text>
        <TouchableOpacity
          onPress={() => setShowBulkCategoryPicker(true)}
          style={styles.bulkBarPrimary}
        >
          <Ionicons name="pricetags-outline" size={16} color="#fff" />
          <Text style={styles.bulkBarPrimaryText}>Set category</Text>
        </TouchableOpacity>
      </View>
    )}

    <Modal
      visible={showBulkCategoryPicker}
      animationType="slide"
      transparent
      onRequestClose={() => setShowBulkCategoryPicker(false)}
    >
      <Pressable
        style={styles.bulkPickerBackdrop}
        onPress={() => setShowBulkCategoryPicker(false)}
      >
        <Pressable style={styles.bulkPickerSheet} onPress={() => {}}>
          <Text style={styles.bulkPickerTitle}>
            Tag {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} as
          </Text>
          <View style={styles.bulkPickerGrid}>
            {[
              ...ALL_CATEGORIES,
              // Surface receipt-level custom tags too so users can bulk-
              // assign to a tag they've already added (e.g. "Gym",
              // "Pet Food"). De-dupe against the standard set.
              ...categoryTags.filter(
                (t) => !(ALL_CATEGORIES as readonly string[]).includes(t),
              ),
            ].map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => applyBulkCategory(c)}
                style={styles.bulkPickerOption}
              >
                <TagChip tag={c} size="md" />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.bulkPickerCustomLabel}>Or add a new tag</Text>
          <View style={styles.bulkPickerCustomRow}>
            <TextInput
              value={bulkCustomTag}
              onChangeText={setBulkCustomTag}
              placeholder="Garden Supplies"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submitBulkCustomTag}
              maxLength={32}
              style={styles.bulkPickerCustomInput}
            />
            <TouchableOpacity
              onPress={submitBulkCustomTag}
              disabled={!bulkCustomTag.trim()}
              style={[
                styles.bulkPickerCustomBtn,
                !bulkCustomTag.trim() && { opacity: 0.4 },
              ]}
            >
              <Text style={styles.bulkPickerCustomBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </View>
  );
}
