import React from 'react';
import {
  Pressable,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../../constants/theme';

interface Props {
  /** Ionicon name for the central icon. */
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  /** Optional call-to-action button rendered below the text. */
  actionLabel?: string;
  onAction?: () => void;
  /** Override the accent color used for the icon halo + CTA. Defaults
   *  to the theme's primary green. */
  tint?: string;
  style?: ViewStyle;
}

/**
 * Friendly empty-state illustration used across screens with no data.
 * Renders a large icon sitting in a soft circular halo + a stack of
 * decorative concentric rings, with title/description text and an
 * optional CTA. Replaces the small "icon + text" pattern that used
 * to appear inline across the app.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  tint,
  style,
}: Props) {
  const theme = useTheme();
  const accent = tint ?? theme.colors.accent;
  const styles = useStyles((t) => ({
    root: {
      alignItems: 'center',
      paddingVertical: t.spacing.xl,
      paddingHorizontal: t.spacing.lg,
      gap: t.spacing.sm,
    },
    haloOuter: {
      width: 140,
      height: 140,
      borderRadius: 70,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing.sm,
    },
    haloMiddle: {
      width: 110,
      height: 110,
      borderRadius: 55,
      alignItems: 'center',
      justifyContent: 'center',
    },
    haloInner: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.xl,
      textAlign: 'center',
      marginTop: t.spacing.xs,
    },
    description: {
      color: t.colors.textSecondary,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.sm,
      textAlign: 'center',
      lineHeight: 20,
      maxWidth: 300,
    },
    cta: {
      marginTop: t.spacing.md,
      paddingHorizontal: t.spacing.lg,
      paddingVertical: 12,
      borderRadius: t.radius.md,
      backgroundColor: accent,
    },
    ctaText: {
      color: '#FFFFFF',
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
  }));

  return (
    <View style={[styles.root, style]}>
      <View style={[styles.haloOuter, { backgroundColor: `${accent}08` }]}>
        <View style={[styles.haloMiddle, { backgroundColor: `${accent}14` }]}>
          <View style={[styles.haloInner, { backgroundColor: `${accent}22` }]}>
            <Ionicons name={icon} size={42} color={accent} />
          </View>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? (
        <Text style={styles.description}>{description}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
