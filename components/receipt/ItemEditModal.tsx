import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Category, LineItem } from '../../types';
import { ALL_CATEGORIES } from '../../constants/categories';
import { useStyles, useTheme } from '../../constants/theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TagChip } from '../ui/TagChip';

/**
 * Modal for editing a single detected line item — name, amount,
 * category, or delete it entirely. Used by both the scan review
 * screen and the receipt detail screen so users can fix small OCR /
 * AI parse mistakes inline.
 */
export function ItemEditModal({
  item,
  onClose,
  onSave,
  onDelete,
  extraTags = [],
  onAddCustomTag,
}: {
  item: LineItem | null;
  onClose: () => void;
  onSave: (updated: LineItem) => void;
  onDelete: (id: string) => void;
  /** Custom tags from the parent receipt that should appear in the
   *  category picker alongside the 10 standard categories. */
  extraTags?: string[];
  /** Called when the user adds a brand-new tag from inside the
   *  category picker. The parent should append it to the receipt-
   *  level categoryTags so it stays in sync across all items on
   *  this receipt. */
  onAddCustomTag?: (tag: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    root: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    title: {
      color: t.colors.textPrimary,
      fontSize: t.font.lg,
      fontWeight: '700',
    },
    content: {
      padding: t.spacing.md,
      gap: t.spacing.sm,
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
    addTagBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      marginTop: t.spacing.xs,
    },
    addTagBtnText: {
      color: t.colors.accent,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    addTagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: t.spacing.xs,
    },
    addTagInput: {
      flex: 1,
      backgroundColor: t.colors.surfaceHigh,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    addTagSaveBtn: {
      backgroundColor: t.colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: t.radius.sm,
    },
    addTagSaveText: {
      color: '#fff',
      fontSize: t.font.sm,
      fontWeight: '700',
    },
  }));
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category | string>('Other');
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    if (item) {
      setName(item.name);
      setAmount(item.amount.toFixed(2));
      setCategory(item.category ?? 'Other');
      setShowCatPicker(false);
      setAddingTag(false);
      setTagDraft('');
    }
  }, [item]);

  const standardSet = new Set<string>(ALL_CATEGORIES);
  const customOptions = extraTags.filter((t) => !standardSet.has(t));
  // If the current category is a custom one not in extraTags (legacy
  // data, or the user cleared the receipt tag), keep it visible too.
  if (
    !standardSet.has(category) &&
    !customOptions.includes(category)
  ) {
    customOptions.push(category);
  }
  const pickerOptions: (Category | string)[] = [
    ...ALL_CATEGORIES,
    ...customOptions,
  ];

  const submit = () => {
    if (!item) return;
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter an item name.');
      return;
    }
    const amountVal = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountVal)) {
      Alert.alert('Invalid amount', 'Please enter a valid amount.');
      return;
    }
    onSave({ ...item, name: name.trim(), amount: amountVal, category });
  };

  const commitTagDraft = () => {
    const trimmed = tagDraft.trim();
    if (!trimmed) {
      setAddingTag(false);
      return;
    }
    if (trimmed.length > 32) {
      Alert.alert('Tag too long', 'Keep tags under 32 characters.');
      return;
    }
    // De-dupe against standard categories + existing extras (case-insensitive),
    // but accept any new label as the item's category either way.
    const exists = pickerOptions.find(
      (c) => c.toLowerCase() === trimmed.toLowerCase(),
    );
    const finalTag = exists ?? trimmed;
    setCategory(finalTag);
    setAddingTag(false);
    setTagDraft('');
    setShowCatPicker(false);
    // Only propagate truly-new tags up to the parent so the receipt's
    // shared categoryTags list grows without dupes.
    if (!exists && onAddCustomTag) onAddCustomTag(trimmed);
  };

  const confirmDelete = () => {
    if (!item) return;
    Alert.alert('Delete item?', `Remove "${item.name}" from this receipt?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(item.id) },
    ]);
  };

  return (
    <Modal
      visible={item != null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit item</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Item name"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Amount ($)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Category</Text>
            <TouchableOpacity
              onPress={() => setShowCatPicker((v) => !v)}
              style={styles.categorySelector}
            >
              <TagChip tag={category} />
              <Ionicons
                name={showCatPicker ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={theme.colors.textSecondary}
              />
            </TouchableOpacity>
            {showCatPicker && (
              <>
                <View style={styles.categoryGrid}>
                  {pickerOptions.map((c) => (
                    <TagChip
                      key={c}
                      tag={c}
                      selected={c === category}
                      size="sm"
                      onToggle={() => {
                        setCategory(c);
                        setShowCatPicker(false);
                      }}
                    />
                  ))}
                </View>
                {!addingTag ? (
                  <Pressable
                    onPress={() => setAddingTag(true)}
                    style={styles.addTagBtn}
                    hitSlop={6}
                  >
                    <Ionicons name="add" size={14} color={theme.colors.accent} />
                    <Text style={styles.addTagBtnText}>Add custom tag</Text>
                  </Pressable>
                ) : (
                  <View style={styles.addTagRow}>
                    <TextInput
                      value={tagDraft}
                      onChangeText={setTagDraft}
                      placeholder="e.g. Pet Food"
                      placeholderTextColor={theme.colors.textMuted}
                      style={styles.addTagInput}
                      autoFocus
                      onSubmitEditing={commitTagDraft}
                      maxLength={32}
                      autoCapitalize="words"
                    />
                    <Pressable
                      onPress={commitTagDraft}
                      style={styles.addTagSaveBtn}
                      hitSlop={6}
                    >
                      <Text style={styles.addTagSaveText}>Add</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setAddingTag(false);
                        setTagDraft('');
                      }}
                      hitSlop={10}
                    >
                      <Ionicons
                        name="close"
                        size={20}
                        color={theme.colors.textSecondary}
                      />
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </Card>

          <Button label="Save" onPress={submit} size="lg" style={{ marginTop: theme.spacing.md }} />
          <Button
            label="Delete item"
            onPress={confirmDelete}
            variant="danger"
            size="lg"
            style={{ marginTop: theme.spacing.xs }}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}
