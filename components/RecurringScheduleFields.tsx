import React from 'react';
import { Platform, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { Card } from './ui/Card';
import { DateField } from './ui/DateField';
import { useStyles, useTheme } from '../constants/theme';

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const FREQS: { id: RecurringFrequency; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Bi-weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

export function RecurringScheduleFields({
  title,
  enabled,
  onEnabledChange,
  frequency,
  onFrequencyChange,
  nextDueDate,
  onNextDueDateChange,
  duration,
  onDurationChange,
  durationOptional,
}: {
  title: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  frequency: RecurringFrequency;
  onFrequencyChange: (v: RecurringFrequency) => void;
  nextDueDate: string;
  onNextDueDateChange: (v: string) => void;
  duration: string;
  onDurationChange: (v: string) => void;
  /** When editing an existing schedule, duration can stay blank. */
  durationOptional?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    card: { gap: t.spacing.sm, borderRadius: t.radius.lg },
    toggleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    label: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '800' as const,
      fontFamily: t.fonts.display.bold,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.8,
    },
    title: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontFamily: t.fonts.body.medium,
      fontWeight: '600' as const,
      flex: 1,
      paddingRight: 12,
    },
    segmented: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    tab: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: t.radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    tabText: {
      fontSize: t.font.xs,
      fontWeight: '700' as const,
      color: t.colors.textSecondary,
    },
    input: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontFamily: t.fonts.mono.medium,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
  }));

  return (
    <Card style={styles.card}>
      <View style={styles.toggleRow}>
        <Text style={styles.title}>{title}</Text>
        <Switch
          value={enabled}
          onValueChange={onEnabledChange}
          trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
          thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
        />
      </View>
      {enabled ? (
        <>
          <View style={styles.segmented}>
            {FREQS.map((f) => {
              const active = frequency === f.id;
              return (
                <Pressable
                  key={f.id}
                  style={[styles.tab, active && { backgroundColor: theme.colors.accent }]}
                  onPress={() => onFrequencyChange(f.id)}
                >
                  <Text style={[styles.tabText, active && { color: '#fff' }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Next auto-add date</Text>
          <DateField value={nextDueDate} onChange={onNextDueDateChange} placeholder="Select date" />
          <Text style={styles.label}>
            For how many months{durationOptional ? ' (optional)' : ''}
          </Text>
          <TextInput
            style={styles.input}
            value={duration}
            onChangeText={onDurationChange}
            placeholder="12"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
          />
        </>
      ) : null}
    </Card>
  );
}
