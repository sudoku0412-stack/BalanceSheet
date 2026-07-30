import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useStyles, useTheme } from '../../constants/theme';

/**
 * Pure-JS calendar date picker. No native modules — works on any
 * existing OTA install. Renders a centered modal card with a
 * standard month grid (7 columns x ~5 rows), prev/next month
 * chevrons, and a Done button. Tapping a day cell commits the
 * selection and closes the modal.
 *
 * Bounded by `minDate` / `maxDate` (inclusive). Out-of-range days
 * render dimmed and ignore taps.
 */
export function DatePickerModal({
  visible,
  initialDate,
  minDate,
  maxDate,
  title,
  onClose,
  onSelect,
}: {
  visible: boolean;
  initialDate: Date;
  minDate?: Date;
  maxDate?: Date;
  title?: string;
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
      maxWidth: 360,
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
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingVertical: 6,
    },
    monthBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthLabel: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '700',
    },
    weekdayRow: {
      flexDirection: 'row',
      marginTop: 6,
      marginBottom: 4,
    },
    weekdayCell: {
      flex: 1,
      textAlign: 'center',
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    dayCell: {
      width: `${100 / 7}%` as `${number}%`,
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.full,
    },
    dayCellSelected: {
      backgroundColor: t.colors.accent,
    },
    dayText: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '500',
    },
    dayTextDisabled: {
      color: t.colors.textMuted,
      opacity: 0.35,
    },
    dayTextToday: {
      color: t.colors.accent,
      fontWeight: '700',
    },
    dayTextSelected: {
      color: '#fff',
      fontWeight: '700',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: t.spacing.sm,
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
    doneBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.accent,
    },
    doneBtnText: {
      color: '#fff',
      fontSize: t.font.sm,
      fontWeight: '700',
    },
  }));
  // The month being browsed. Starts at initialDate's month, but the
  // user can flip back and forward without committing until they tap
  // a specific day.
  const [browseMonth, setBrowseMonth] = useState<Date>(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
  );
  const [selected, setSelected] = useState<Date>(initialDate);

  // Reset state whenever the modal opens — otherwise old browse-state
  // persists across opens.
  React.useEffect(() => {
    if (visible) {
      setBrowseMonth(
        new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
      );
      setSelected(initialDate);
    }
  }, [visible, initialDate]);

  const year = browseMonth.getFullYear();
  const month = browseMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
  // Build a flat list of cells: leading blanks + 1..daysInMonth.
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  // Pad to a multiple of 7 for clean rows.
  while (cells.length % 7 !== 0) cells.push({ day: null });

  const stripTime = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const minMs = minDate ? stripTime(minDate) : -Infinity;
  const maxMs = maxDate ? stripTime(maxDate) : Infinity;
  const selectedMs = stripTime(selected);
  const todayMs = stripTime(new Date());

  const isInRange = (day: number) =>
    stripTime(new Date(year, month, day)) >= minMs &&
    stripTime(new Date(year, month, day)) <= maxMs;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {title ? <Text style={styles.title}>{title}</Text> : null}

          {/* Month navigator */}
          <View style={styles.monthRow}>
            <TouchableOpacity
              onPress={() => setBrowseMonth(new Date(year, month - 1, 1))}
              hitSlop={10}
              style={styles.monthBtn}
            >
              <Ionicons
                name="chevron-back"
                size={20}
                color={theme.colors.textPrimary}
              />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>
              {format(browseMonth, 'MMMM yyyy')}
            </Text>
            <TouchableOpacity
              onPress={() => setBrowseMonth(new Date(year, month + 1, 1))}
              hitSlop={10}
              style={styles.monthBtn}
            >
              <Ionicons
                name="chevron-forward"
                size={20}
                color={theme.colors.textPrimary}
              />
            </TouchableOpacity>
          </View>

          {/* Weekday header */}
          <View style={styles.weekdayRow}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <Text key={d} style={styles.weekdayCell}>
                {d}
              </Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {cells.map((c, idx) => {
              if (c.day == null) {
                return <View key={idx} style={styles.dayCell} />;
              }
              const cellMs = stripTime(new Date(year, month, c.day));
              const inRange = isInRange(c.day);
              const isSelected = cellMs === selectedMs;
              const isToday = cellMs === todayMs;
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => {
                    if (!inRange) return;
                    setSelected(new Date(year, month, c.day!));
                  }}
                  disabled={!inRange}
                  style={[
                    styles.dayCell,
                    isSelected && styles.dayCellSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      !inRange && styles.dayTextDisabled,
                      isToday && !isSelected && styles.dayTextToday,
                      isSelected && styles.dayTextSelected,
                    ]}
                  >
                    {c.day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onSelect(selected)}
              style={styles.doneBtn}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
