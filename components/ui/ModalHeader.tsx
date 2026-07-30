import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStyles, useTheme } from '../../constants/theme';

interface RightAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}

interface Props {
  title: string;
  /** Optional emoji prefix shown before the title. */
  iconLeading?: string;
  /** Override the title's color (used by drilldown to match the category accent). */
  titleColor?: string;
  /** Override the back button behavior — defaults to router.back(). */
  onBack?: () => void;
  /** Hide the back button entirely. */
  hideBack?: boolean;
  /** Up to two action buttons on the right. */
  rightActions?: RightAction[];
  style?: ViewStyle;
}

/**
 * Shared header used by all full-screen modal routes (Reports,
 * Category Drilldown, Edit Profile, etc.). Gives every modal the
 * same back chevron on the left, a centered title, and 0-2 action
 * icons on the right, with consistent spacing and theme styling.
 *
 * The screen file owns the SafeAreaView; this just renders the
 * header row below it.
 */
export function ModalHeader({
  title,
  iconLeading,
  titleColor,
  onBack,
  hideBack,
  rightActions = [],
  style,
}: Props) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    root: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
      backgroundColor: t.colors.background,
      minHeight: 52,
    },
    side: {
      flexDirection: 'row',
      alignItems: 'center',
      // Reserve equal-width space on both sides so the title sits
      // visually centered. Two icon slots = 80px.
      width: 80,
    },
    iconBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    titleEmoji: {
      fontSize: t.font.lg,
    },
    title: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.lg,
    },
  }));

  return (
    <View style={[styles.root, style]}>
      <View style={styles.side}>
        {!hideBack ? (
          <Pressable
            onPress={onBack ?? (() => router.back())}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons
              name="chevron-back"
              size={26}
              color={theme.colors.textPrimary}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.titleWrap}>
        {iconLeading ? (
          <Text style={styles.titleEmoji}>{iconLeading}</Text>
        ) : null}
        <Text
          style={[styles.title, titleColor ? { color: titleColor } : null]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>

      <View style={[styles.side, { justifyContent: 'flex-end' }]}>
        {rightActions.map((a, i) => (
          <Pressable
            key={i}
            onPress={a.onPress}
            disabled={a.disabled || a.loading}
            hitSlop={10}
            style={[styles.iconBtn, (a.disabled || a.loading) && { opacity: 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel={a.accessibilityLabel}
          >
            {a.loading ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Ionicons
                name={a.icon}
                size={22}
                color={theme.colors.textPrimary}
              />
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
