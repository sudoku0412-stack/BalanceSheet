import React, { useState } from 'react';
import { Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../../constants/theme';
import {
  addCustomCategory,
  MAX_CUSTOM_CATEGORY_NAME,
  type AddCustomCategoryResult,
  type CustomCategory,
} from '../../lib/customCategories';

import { useT } from '../../lib/I18nContext';
const ERROR_TEXT: Record<Extract<AddCustomCategoryResult, { ok: false }>['reason'], string> = {
  empty: 'Enter a name.',
  tooLong: `Keep it under ${MAX_CUSTOM_CATEGORY_NAME} characters.`,
  duplicate: 'That category already exists.',
  limit: 'Custom category limit reached.',
};

/**
 * Premium custom categories inside a category chip area: the user's own
 * categories as selectable chips, plus an "add" affordance. Free users
 * still see the user's existing custom chips (so nothing disappears if
 * Premium lapses) but the add button routes to the paywall.
 */
export function CustomCategoryPicker({
  householdId,
  customs,
  selected,
  isPremium,
  onSelect,
  onCustomsChange,
  onUpgrade,
}: {
  householdId: string | null;
  customs: CustomCategory[];
  selected: string;
  isPremium: boolean;
  onSelect: (name: string) => void;
  onCustomsChange: (next: CustomCategory[]) => void;
  onUpgrade: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const styles = useStyles((t) => ({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderRadius: t.radius.full,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipText: { fontSize: t.font.sm, fontFamily: t.fonts.display.bold },
    addChip: { borderColor: t.colors.border, borderStyle: 'dashed' },
    addText: { color: t.colors.accent, fontSize: t.font.sm, fontFamily: t.fonts.display.bold },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
    },
    errorText: { color: t.colors.error, fontSize: t.font.xs, marginTop: 4 },
  }));

  const submit = async () => {
    if (!householdId) return;
    const result = await addCustomCategory(householdId, name);
    if (!result.ok) {
      setError(ERROR_TEXT[result.reason]);
      return;
    }
    onCustomsChange(result.categories);
    onSelect(result.added.name);
    setName('');
    setError(null);
    setAdding(false);
  };

  return (
    <View>
      <View style={styles.row}>
        {customs.map((c) => {
          const active = selected === c.name;
          return (
            <TouchableOpacity
              key={c.name}
              testID={`custom-chip-${c.name}`}
              onPress={() => onSelect(c.name)}
              activeOpacity={0.7}
              style={[
                styles.chip,
                { backgroundColor: active ? c.color : 'transparent', borderColor: c.color },
              ]}
            >
              {active && <Ionicons name="checkmark" size={14} color="#fff" />}
              <Text style={[styles.chipText, { color: active ? '#fff' : c.color }]}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
        {!adding && (
          <TouchableOpacity
            testID="custom-category-add"
            onPress={() => (isPremium ? setAdding(true) : onUpgrade())}
            activeOpacity={0.7}
            style={[styles.chip, styles.addChip]}
          >
            <Ionicons name="add" size={14} color={theme.colors.accent} />
            <Text style={styles.addText}>
              {isPremium ? t('customCategory') : t('customCategoryPremium')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {adding && (
        <View>
          <View style={styles.addRow}>
            <TextInput
              testID="custom-category-input"
              style={styles.input}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder={t('eGPets')}
              placeholderTextColor={theme.colors.textMuted}
              maxLength={MAX_CUSTOM_CATEGORY_NAME + 5}
              autoFocus
              onSubmitEditing={submit}
            />
            <Pressable testID="custom-category-save" onPress={submit} hitSlop={6}>
              <Text style={styles.addText}>{t('add')}</Text>
            </Pressable>
            <Pressable
              testID="custom-category-cancel"
              onPress={() => {
                setAdding(false);
                setName('');
                setError(null);
              }}
              hitSlop={6}
            >
              <Text style={[styles.addText, { color: theme.colors.textMuted }]}>{t('cancel')}</Text>
            </Pressable>
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      )}
    </View>
  );
}
