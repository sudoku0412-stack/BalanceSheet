import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../../constants/theme';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr',
  'May', 'Jun', 'Jul', 'Aug',
  'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Compact month/year picker for the dashboard total card. Tap the
 * "May 2026" label to open this; pick a year with the chevrons and
 * a month from the 4×3 grid. Tap "This Month" to snap back to today.
 */
export function MonthYearPicker({
  visible,
  selected,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selected: Date;
  onClose: () => void;
  onSelect: (d: Date) => void;
}) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: t.spacing.md,
    },
    card: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      padding: t.spacing.md,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    title: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: t.spacing.sm,
    },
    yearRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    yearBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.full,
    },
    yearLabel: {
      color: t.colors.textPrimary,
      fontSize: t.font.lg,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: t.spacing.xs,
    },
    cell: {
      width: '25%' as const,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellInner: {
      width: '88%',
      paddingVertical: 10,
      borderRadius: t.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellInnerSelected: {
      backgroundColor: t.colors.accent,
    },
    cellInnerToday: {
      borderWidth: 1,
      borderColor: t.colors.accent,
    },
    cellText: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    cellTextSelected: {
      color: '#fff',
      fontWeight: '700',
    },
    cellTextToday: {
      color: t.colors.accent,
      fontWeight: '700',
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: t.spacing.sm,
      gap: t.spacing.sm,
    },
    todayBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: t.radius.full,
      backgroundColor: `${t.colors.accent}1A`,
    },
    todayBtnText: {
      color: t.colors.accent,
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    cancelBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: t.radius.full,
    },
    cancelBtnText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    spacer: {
      flex: 1,
    },
  }));

  const today = new Date();
  const [browseYear, setBrowseYear] = useState<number>(selected.getFullYear());
  const isOnToday =
    selected.getFullYear() === today.getFullYear() &&
    selected.getMonth() === today.getMonth();

  // Reset browse year whenever the picker opens, so it always lands
  // on the currently-selected month's year rather than wherever the
  // user navigated to last time.
  React.useEffect(() => {
    if (visible) setBrowseYear(selected.getFullYear());
  }, [visible, selected]);

  const pick = (monthIndex: number) => {
    onSelect(new Date(browseYear, monthIndex, 1));
    onClose();
  };

  const jumpToToday = () => {
    onSelect(new Date(today.getFullYear(), today.getMonth(), 1));
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Select Month</Text>

          <View style={styles.yearRow}>
            <TouchableOpacity
              style={styles.yearBtn}
              onPress={() => setBrowseYear((y) => y - 1)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Previous year"
            >
              <Ionicons name="chevron-back" size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.yearLabel}>{browseYear}</Text>
            <TouchableOpacity
              style={styles.yearBtn}
              onPress={() => setBrowseYear((y) => y + 1)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Next year"
            >
              <Ionicons name="chevron-forward" size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.grid}>
            {MONTH_LABELS.map((label, idx) => {
              const isSelected =
                browseYear === selected.getFullYear() && idx === selected.getMonth();
              const isCurrent =
                browseYear === today.getFullYear() && idx === today.getMonth();
              return (
                <View key={label} style={styles.cell}>
                  <TouchableOpacity
                    style={[
                      styles.cellInner,
                      isSelected && styles.cellInnerSelected,
                      !isSelected && isCurrent && styles.cellInnerToday,
                    ]}
                    onPress={() => pick(idx)}
                  >
                    <Text
                      style={[
                        styles.cellText,
                        isSelected && styles.cellTextSelected,
                        !isSelected && isCurrent && styles.cellTextToday,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={styles.footer}>
            {isOnToday ? (
              <View style={styles.spacer} />
            ) : (
              <TouchableOpacity style={styles.todayBtn} onPress={jumpToToday}>
                <Ionicons name="today-outline" size={16} color={theme.colors.accent} />
                <Text style={styles.todayBtnText}>This Month</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
