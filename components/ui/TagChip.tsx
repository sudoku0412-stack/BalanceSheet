import React from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Category } from '../../types';
import { ALL_CATEGORIES, CATEGORY_ICONS } from '../../constants/categories';
import { useStyles, useTheme } from '../../constants/theme';

/**
 * A chip that renders any string tag — standard category or custom.
 * Standard tags get the category's color and emoji; custom tags get a
 * neutral surface color and a generic 'pricetag' icon.
 *
 * If `selected=false` is passed, the chip is rendered as an outline
 * "add" affordance. Tap fires onToggle/onPress.
 */
export function TagChip({
  tag,
  selected = true,
  onToggle,
  size = 'md',
  style,
}: {
  tag: string;
  selected?: boolean;
  onToggle?: () => void;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: t.radius.full,
      borderWidth: 1,
    },
    sm: {
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    md: {
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    emoji: {
      marginRight: 4,
    },
    label: {
      fontFamily: t.fonts.display.bold,
    },
  }));
  const standard = isStandardCategory(tag);
  const accent = standard
    ? theme.colors.category[tag as Category]
    : theme.colors.accent;
  const iconName = standard ? null : 'pricetag-outline';
  const emoji = standard ? CATEGORY_ICONS[tag as Category] : '';

  const padded = size === 'sm' ? styles.sm : styles.md;
  const fontSize = size === 'sm' ? theme.font.xs : theme.font.sm;

  const content = (
    <View
      style={[
        styles.chip,
        padded,
        selected
          ? { backgroundColor: `${accent}22`, borderColor: accent }
          : { backgroundColor: 'transparent', borderColor: theme.colors.border, borderStyle: 'dashed' },
        style,
      ]}
    >
      {selected && emoji ? (
        <Text style={[styles.emoji, { fontSize }]}>{emoji}</Text>
      ) : null}
      {!selected || iconName ? (
        <Ionicons
          name={selected ? (iconName as keyof typeof Ionicons.glyphMap | null) ?? 'checkmark' : 'add'}
          size={size === 'sm' ? 12 : 14}
          color={selected ? accent : theme.colors.textSecondary}
          style={{ marginRight: 4 }}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          { fontSize, color: selected ? accent : theme.colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {tag}
      </Text>
    </View>
  );

  if (!onToggle) return content;
  return (
    <Pressable onPress={onToggle} hitSlop={4}>
      {content}
    </Pressable>
  );
}

function isStandardCategory(tag: string): boolean {
  return (ALL_CATEGORIES as readonly string[]).includes(tag);
}
