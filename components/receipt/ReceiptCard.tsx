import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { Receipt } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';

interface Props {
  receipt: Receipt;
  onDelete?: (id: string) => void;
}

function dateLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d');
}

/**
 * Recent-expense row: circular category-colored avatar with the
 * merchant's first letter, merchant name + "{category} · {date}",
 * right-aligned amount in Roboto Mono. Matches the design system's
 * "Recent"/"Expenses" list row spec.
 */
export function ReceiptCard({ receipt, onDelete }: Props) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      padding: t.spacing.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      justifyContent: 'space-between',
    },
    left: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      flex: 1,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: t.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarText: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: '#fff',
    },
    info: {
      flex: 1,
      gap: 2,
    },
    storeName: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: t.colors.textPrimary,
    },
    meta: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textMuted,
    },
    right: {
      alignItems: 'flex-end',
      gap: 8,
      flexShrink: 0,
      paddingLeft: t.spacing.sm,
    },
    amount: {
      fontFamily: t.fonts.mono.medium,
      fontSize: t.font.md,
      color: t.colors.textPrimary,
    },
  }));
  const router = useRouter();
  const color = theme.colors.category[receipt.category];

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => router.push(`/edit/${receipt.id}`)}
      style={styles.card}
    >
      <View style={styles.left}>
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <Text style={styles.avatarText}>{receipt.storeName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.storeName} numberOfLines={1}>
            {receipt.storeName}
          </Text>
          <Text style={styles.meta}>
            {receipt.category} · {dateLabel(new Date(receipt.date))}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <Text style={styles.amount}>${receipt.totalAmount.toFixed(2)}</Text>
        {onDelete && (
          <TouchableOpacity
            onPress={() => onDelete(receipt.id)}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityRole="button"
            accessibilityLabel="Delete receipt"
          >
            <Ionicons name="trash-outline" size={16} color={theme.colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}
