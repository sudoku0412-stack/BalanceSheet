import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useStyles, useTheme } from '../../constants/theme';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
}: Props) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    base: {
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primary: {
      backgroundColor: t.colors.primary,
    },
    secondary: {
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    ghost: {
      backgroundColor: 'transparent',
    },
    danger: {
      backgroundColor: t.colors.error,
    },
    disabled: {
      opacity: 0.45,
    },
    size_sm: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: t.radius.sm },
    size_md: { paddingHorizontal: 20, paddingVertical: 12 },
    size_lg: { paddingHorizontal: 28, paddingVertical: 16 },
    text: {
      fontFamily: t.fonts.display.bold,
      textTransform: 'uppercase',
      letterSpacing: 0.04,
    },
    text_primary: { color: '#fff' },
    text_secondary: { color: t.colors.textPrimary },
    text_ghost: { color: t.colors.accent },
    text_danger: { color: '#fff' },
    textSize_sm: { fontSize: t.font.xs },
    textSize_md: { fontSize: t.font.sm },
    textSize_lg: { fontSize: t.font.sm },
  }));
  const isDisabled = disabled || loading;

  const spinnerColor =
    variant === 'primary' || variant === 'danger'
      ? '#fff'
      : variant === 'ghost'
        ? theme.colors.accent
        : theme.colors.textPrimary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      disabled={isDisabled}
      style={[
        styles.base,
        styles[variant],
        styles[`size_${size}`],
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <Text style={[styles.text, styles[`text_${variant}`], styles[`textSize_${size}`], textStyle]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}
