import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ALL_CATEGORIES } from '../../constants/categories';
import { useStyles, useTheme } from '../../constants/theme';
import { TagChip } from './TagChip';

/**
 * Multi-select chip group for the receipt's category tags. Shows the
 * selected tags as filled chips, the unselected standard categories
 * underneath as dashed-outline "add" chips, and an "Add custom tag"
 * action that opens a small text input.
 *
 * Tags can be any string. Standard categories ('Groceries', etc.) are
 * styled with their colour/emoji; custom strings get neutral styling.
 */
export function CategoryTagsPicker({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    root: { gap: 8 },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    emptyHint: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
    },
    sectionHint: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      marginTop: 6,
      marginBottom: 2,
    },
    customBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    customBtnText: {
      color: t.colors.accent,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    customRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    customInput: {
      flex: 1,
      backgroundColor: t.colors.background,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    customSaveBtn: {
      backgroundColor: t.colors.accent,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: t.radius.sm,
    },
    customSaveText: {
      color: '#fff',
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    customSelectedHint: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontStyle: 'italic',
    },
  }));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const selectedSet = new Set(tags);
  const standardUnselected = ALL_CATEGORIES.filter((c) => !selectedSet.has(c));
  const customSelected = tags.filter((t) => !(ALL_CATEGORIES as readonly string[]).includes(t));

  const toggle = (tag: string) => {
    if (selectedSet.has(tag)) {
      onChange(tags.filter((t) => t !== tag));
    } else {
      onChange([...tags, tag]);
    }
  };

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setAdding(false);
      return;
    }
    if (trimmed.length > 32) {
      Alert.alert('Tag too long', 'Keep tags under 32 characters.');
      return;
    }
    if (!selectedSet.has(trimmed)) onChange([...tags, trimmed]);
    setDraft('');
    setAdding(false);
  };

  return (
    <View style={styles.root}>
      {tags.length === 0 ? (
        <Text style={styles.emptyHint}>No tags yet — pick or add below</Text>
      ) : (
        <View style={styles.row}>
          {tags.map((tag) => (
            <TagChip
              key={`s:${tag}`}
              tag={tag}
              selected
              onToggle={() => toggle(tag)}
            />
          ))}
        </View>
      )}

      {standardUnselected.length > 0 && (
        <>
          <Text style={styles.sectionHint}>Add a standard category</Text>
          <View style={styles.row}>
            {standardUnselected.map((c) => (
              <TagChip
                key={`u:${c}`}
                tag={c}
                selected={false}
                size="sm"
                onToggle={() => toggle(c)}
              />
            ))}
          </View>
        </>
      )}

      {!adding ? (
        <Pressable
          onPress={() => setAdding(true)}
          style={styles.customBtn}
          hitSlop={6}
        >
          <Ionicons name="add" size={14} color={theme.colors.accent} />
          <Text style={styles.customBtnText}>Add custom tag</Text>
        </Pressable>
      ) : (
        <View style={styles.customRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="e.g. Pet Food"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.customInput}
            autoFocus
            onSubmitEditing={commitDraft}
            maxLength={32}
            autoCapitalize="words"
          />
          <Pressable onPress={commitDraft} style={styles.customSaveBtn} hitSlop={6}>
            <Text style={styles.customSaveText}>Add</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setAdding(false);
              setDraft('');
            }}
            hitSlop={10}
          >
            <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {customSelected.length > 0 && (
        <Text style={styles.customSelectedHint}>
          Custom: {customSelected.join(', ')}
        </Text>
      )}
    </View>
  );
}
