import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useStyles } from '../../constants/theme';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
}

export function Card({ children, style, elevated = false }: Props) {
  const styles = useStyles((t) => ({
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: 20,
      padding: t.spacing.md,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    elevated: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: t.isDark ? 0.45 : 0.14,
      shadowRadius: 14,
      elevation: 6,
    },
  }));
  return (
    <View style={[styles.card, elevated && styles.elevated, style]}>
      {children}
    </View>
  );
}
