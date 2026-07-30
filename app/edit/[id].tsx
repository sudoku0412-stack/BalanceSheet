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
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import { format, formatDistanceToNow } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import {
  getReceiptById,
  updateReceipt,
  deleteReceipt,
  replaceLineItems,
} from '../../lib/database';
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

/** Safe wrapper around date-fns formatDistanceToNow() for the hero meta
 *  line — same "legacy receipt may have a bad timestamp" guard as
 *  safeFormat above, just producing "3 days ago" instead of a date. */
function safeRelative(input: unknown): string {
  if (input == null || input === '') return '';
  try {
    const d = new Date(input as string);
    if (isNaN(d.getTime())) return '';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return '';
  }
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

export default function EditReceiptScreenWrapped() {
  return (
    <ErrorBoundary>
      <EditReceiptScreen />
    </ErrorBoundary>
  );
}

function EditReceiptScreen() {
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      paddingHorizontal: t.spacing.md,
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.xs,
    },
    headerBack: {
      padding: t.spacing.xs,
      marginLeft: -t.spacing.xs,
    },
    headerTitle: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 2,
    },
    imageBox: {
      width: '100%',
      height: 220,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceHigh,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing.md,
    },
    image: {
      width: '100%',
      height: '100%',
    },
    imagePlaceholderText: {
      color: t.colors.textMuted,
      fontSize: t.font.sm,
      marginTop: t.spacing.xs,
    },
    merchantName: {
      color: t.colors.textPrimary,
      fontSize: t.font.xxl,
      fontWeight: '800',
    },
    heroAmount: {
      color: t.colors.textPrimary,
      fontSize: t.font.xxxl,
      fontWeight: '800',
      marginTop: t.spacing.xs,
    },
    heroMeta: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      marginTop: t.spacing.xs,
    },
    heroCategoryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: t.spacing.sm,
      marginBottom: t.spacing.md,
    },
    heroCategoryDot: {
      width: 10,
      height: 10,
      borderRadius: t.radius.full,
    },
    heroCategoryLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      fontWeight: '600',
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
    categorySelector: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    categoryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: t.spacing.xs,
    },
    categoryOption: {
      borderRadius: t.radius.full,
      borderWidth: 1,
      borderColor: 'transparent',
      padding: 2,
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
      fontFamily: 'monospace',
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
    deleteBtn: {
      marginTop: t.spacing.xs,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.colors.error,
    },
    deleteBtnText: {
      color: t.colors.error,
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
      borderRadius: t.radius.full,
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
      borderTopLeftRadius: t.radius.xl,
      borderTopRightRadius: t.radius.xl,
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

  // This screen owns its own header (small-caps title + back chevron,
  // per the new visual spec) instead of the native one configured in
  // app/_layout.tsx, so headerShown:false needs to apply across every
  // return path below — not just the loaded one — or the native "Edit
  // Receipt" header would flash briefly during loading/not-found.
  const hiddenHeader = <Stack.Screen options={{ headerShown: false }} />;

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]} edges={['top']}>
        {hiddenHeader}
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (!receipt) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]} edges={['top']}>
        {hiddenHeader}
        <Text style={styles.notFoundText}>Receipt not found</Text>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </SafeAreaView>
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

  // Relative timestamps for the hero meta line. No payment-method /
  // card-last4 metadata exists anywhere in the Receipt type or
  // lib/cloudSync — see grep before this change — so the meta line
  // is just the relative added/edited dates, guarded the same way
  // safeFormat guards legacy bad timestamps.
  const addedRelative = safeRelative(receipt.createdAt);
  const editedRelative =
    receipt.updatedAt && receipt.updatedAt !== receipt.createdAt
      ? safeRelative(receipt.updatedAt)
      : '';
  const heroMetaText = [
    addedRelative && `Added ${addedRelative}`,
    editedRelative && `Edited ${editedRelative}`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Same "derive primary from tags" logic as handleSave, so the hero
  // category dot/label reflects live edits to the Categories chip list
  // instead of only the value loaded from disk.
  const heroCategory: Category =
    (categoryTags.find((t) =>
      (ALL_CATEGORIES as readonly string[]).includes(t),
    ) as Category | undefined) ?? category;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
    {hiddenHeader}
    {/* Custom header — small-caps title + back chevron per the new
        visual spec, replacing the native stack header. */}
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={styles.headerBack}
        hitSlop={10}
      >
        <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Expense</Text>
    </View>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        selectionMode && { paddingBottom: 100 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Receipt image — bordered rounded box per the new hero style.
          Hides the <Image> itself (falling back to the placeholder
          box) if the file is missing — older receipts may have stale
          cache:// paths from before we started copying to
          documentDirectory on save. */}
      <View style={styles.imageBox}>
        {receipt.imageUri && !imageMissing ? (
          <Image
            source={{ uri: receipt.imageUri }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImageMissing(true)}
          />
        ) : (
          <>
            <Ionicons name="receipt-outline" size={32} color={theme.colors.textMuted} />
            <Text style={styles.imagePlaceholderText}>No receipt image</Text>
          </>
        )}
      </View>

      {/* Hero — merchant name + amount, mirroring the editable Store/
          Amount cards below so the big display numbers always match
          what's currently typed, even before Save is tapped. */}
      <Text style={styles.merchantName} numberOfLines={1}>
        {storeName || 'Untitled receipt'}
      </Text>
      <Text style={styles.heroAmount}>
        $
        {(() => {
          const parsed = parseFloat(amount.replace(',', '.'));
          return safeAmount(Number.isFinite(parsed) ? parsed : receipt.totalAmount);
        })()}
      </Text>
      {heroMetaText !== '' && <Text style={styles.heroMeta}>{heroMetaText}</Text>}

      <View style={styles.heroCategoryRow}>
        <View
          style={[
            styles.heroCategoryDot,
            { backgroundColor: theme.colors.category[heroCategory] ?? theme.colors.textMuted },
          ]}
        />
        <Text style={styles.heroCategoryLabel}>{heroCategory}</Text>
      </View>

      {/* Store name */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Store / Merchant</Text>
        <TextInput
          style={styles.input}
          value={storeName}
          onChangeText={setStoreName}
          placeholder="Store name"
          placeholderTextColor={theme.colors.textMuted}
          autoCorrect={false}
        />
      </Card>

      {/* Amount */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Total Amount ($)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.colors.textMuted}
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

      {/* Categories — multi-select tags */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Categories</Text>
        <CategoryTagsPicker tags={categoryTags} onChange={setCategoryTags} />
      </Card>

      {/* Notes */}
      <Card style={styles.fieldCard}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
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

      {/* Actions */}
      <Button
        label="Save Changes"
        onPress={handleSave}
        loading={saving}
        size="lg"
        style={styles.saveBtn}
      />

      {/* Red-outlined per the new spec (not solid danger fill) — override
          Button's variant="danger" background/text via style/textStyle
          rather than adding a new variant to components/ui/Button.tsx,
          since this task only touches app/edit/[id].tsx. */}
      <Button
        label="DELETE EXPENSE"
        onPress={handleDelete}
        variant="danger"
        size="lg"
        style={styles.deleteBtn}
        textStyle={styles.deleteBtnText}
      />

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
    </SafeAreaView>
  );
}

