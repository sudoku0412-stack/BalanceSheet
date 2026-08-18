import React from 'react';
import { Platform, Pressable, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useStyles, useTheme } from '../../constants/theme';
import { Card } from './Card';
import { HouseholdMember } from '../../lib/cloudSync';
import { formatCurrency, CurrencyCode } from '../../lib/currency';
import { tapLight } from '../../lib/haptics';
import { LineItem } from '../../types';

function memberLabel(m: HouseholdMember): string {
  return m.displayName?.trim() || m.email?.trim() || 'Member';
}

function initialFor(label: string): string {
  const trimmed = label.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export type SplitMethod = 'equal' | 'percent' | 'amount' | 'shares';

/**
 * Splitwise-style "split this expense" card — participant picker,
 * Equal/%/$ method switch, paid-by picker. Shared between app/edit/[id].tsx
 * (editing an already-saved receipt) and app/(tabs)/scan.tsx (setting the
 * split up AT SAVE TIME instead of requiring a separate edit pass
 * afterward). Fully controlled: all state lives in the caller, this just
 * renders it and reports changes back — so each screen can build its own
 * Receipt.split/paidBy payload however it needs to on save.
 */
export function SplitSection(props: {
  otherMembers: HouseholdMember[];
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  method: SplitMethod;
  onMethodChange: (m: SplitMethod) => void;
  selectedOtherUids: Set<string>;
  onToggleParticipant: (uid: string) => void;
  splitPercents: Record<string, string>;
  onChangePercent: (key: string, value: string) => void;
  splitAmounts: Record<string, string>;
  onChangeAmount: (key: string, value: string) => void;
  /** Share COUNT per participant (method='shares') — e.g. 2 vs. 1 splits
   *  the total 2:1, Splitwise-style. Keyed the same way as splitPercents/
   *  splitAmounts. */
  splitShares: Record<string, string>;
  onChangeShare: (key: string, value: string) => void;
  /** USD-canonical, matching Receipt.totalAmount. */
  totalAmountUsd: number;
  currencyCode: CurrencyCode;
  /** Current (possibly in-progress, unsaved) line items — used for the
   *  per-item split override preview, same as the receipt's own items. */
  lineItems: LineItem[];
}) {
  const theme = useTheme();
  const styles = useSplitSectionStyles();
  const {
    otherMembers,
    enabled,
    onEnabledChange,
    method,
    onMethodChange,
    selectedOtherUids,
    onToggleParticipant,
    splitPercents,
    onChangePercent,
    splitAmounts,
    onChangeAmount,
    splitShares,
    onChangeShare,
    totalAmountUsd,
    currencyCode,
    lineItems,
  } = props;

  const selectedOthers = otherMembers.filter((m) => selectedOtherUids.has(m.uid));
  const participantCount = 1 + selectedOthers.length; // "You" + selected others

  let yourShare = 0;
  let owedToYou = 0;
  let splitWarning: string | null = null;
  // Only meaningful for method === 'shares' — how many shares are in
  // play in total, used for each participant's per-share $ preview.
  let totalShares = 0;

  if (method === 'equal') {
    yourShare = participantCount > 0 ? totalAmountUsd / participantCount : totalAmountUsd;
    owedToYou = totalAmountUsd - yourShare;
  } else if (method === 'percent') {
    const yourPct = parseFloat(splitPercents.self || '0') || 0;
    const othersPct = selectedOthers.reduce(
      (s, m) => s + (parseFloat(splitPercents[m.uid] || '0') || 0),
      0,
    );
    const sumPct = yourPct + othersPct;
    yourShare = (yourPct / 100) * totalAmountUsd;
    owedToYou = (othersPct / 100) * totalAmountUsd;
    if (Math.abs(sumPct - 100) > 0.01) {
      splitWarning = `Percentages add up to ${sumPct.toFixed(0)}%, not 100%.`;
    }
  } else if (method === 'amount') {
    const yourAmt = parseFloat(splitAmounts.self || '0') || 0;
    const othersAmt = selectedOthers.reduce(
      (s, m) => s + (parseFloat(splitAmounts[m.uid] || '0') || 0),
      0,
    );
    const sumAmt = yourAmt + othersAmt;
    yourShare = yourAmt;
    owedToYou = othersAmt;
    if (Math.abs(sumAmt - totalAmountUsd) > 0.01) {
      splitWarning = `Amounts add up to ${formatCurrency(sumAmt, currencyCode)}, not ${formatCurrency(totalAmountUsd, currencyCode)}.`;
    }
  } else {
    const yourShares = parseFloat(splitShares.self || '0') || 0;
    const othersShares = selectedOthers.reduce(
      (s, m) => s + (parseFloat(splitShares[m.uid] || '0') || 0),
      0,
    );
    totalShares = yourShares + othersShares;
    yourShare = totalShares > 0 ? (yourShares / totalShares) * totalAmountUsd : 0;
    owedToYou = totalShares > 0 ? (othersShares / totalShares) * totalAmountUsd : 0;
    if (totalShares <= 0) {
      splitWarning = 'Enter at least one share.';
    }
  }

  // Per-item split override — same math as edit/[id].tsx originally had:
  // when a line item's splitWith is a genuine proper subset of the
  // current participants, the flat Equal/%/$ math is wrong (not
  // everyone shared every item), so recompute item-by-item instead.
  const fullParticipantIds = ['self', ...Array.from(selectedOtherUids)];
  const fullParticipantSet = new Set(fullParticipantIds);
  const usesPerItemSplit =
    enabled &&
    lineItems.some((li) => {
      const sw = li.splitWith;
      if (!sw || sw.length === 0) return false;
      const validSw = sw.filter((p) => fullParticipantSet.has(p));
      return validSw.length > 0 && validSw.length < fullParticipantIds.length;
    });

  const perItemShares: Record<string, number> = {};
  if (usesPerItemSplit) {
    for (const pid of fullParticipantIds) perItemShares[pid] = 0;
    for (const li of lineItems) {
      const itemAmt = typeof li.amount === 'number' && Number.isFinite(li.amount) ? li.amount : 0;
      const validSw = (li.splitWith ?? []).filter((p) => fullParticipantSet.has(p));
      const participants = validSw.length > 0 ? validSw : fullParticipantIds;
      const share = itemAmt / participants.length;
      for (const p of participants) {
        perItemShares[p] = (perItemShares[p] ?? 0) + share;
      }
    }
    yourShare = perItemShares.self ?? 0;
    owedToYou = fullParticipantIds
      .filter((p) => p !== 'self')
      .reduce((s, p) => s + (perItemShares[p] ?? 0), 0);
    splitWarning = null;
  }

  const toggleParticipant = (uid: string) => {
    tapLight();
    onToggleParticipant(uid);
  };

  return (
    <Card style={styles.fieldCard}>
      <Text style={styles.sectionLabel}>SPLIT</Text>
      <View style={styles.splitToggleRow}>
        <Text style={styles.splitToggleLabel}>Split this expense</Text>
        <Switch
          value={enabled}
          onValueChange={onEnabledChange}
          trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
          thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
        />
      </View>

      {enabled && (
        <View style={styles.splitBody}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarWrap}>
              <View style={[styles.avatarCircle, { borderColor: theme.colors.accent, opacity: 1 }]}>
                <Text style={styles.avatarInitial}>Y</Text>
              </View>
              <Text style={styles.avatarLabel} numberOfLines={1}>You</Text>
            </View>
            {otherMembers.map((m) => {
              const label = memberLabel(m);
              const active = selectedOtherUids.has(m.uid);
              return (
                <TouchableOpacity
                  key={m.uid}
                  style={styles.avatarWrap}
                  onPress={() => toggleParticipant(m.uid)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.avatarCircle,
                      { borderColor: active ? theme.colors.accent : 'transparent', opacity: active ? 1 : 0.35 },
                    ]}
                  >
                    <Text style={styles.avatarInitial}>{initialFor(label)}</Text>
                  </View>
                  <Text style={styles.avatarLabel} numberOfLines={1}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {otherMembers.length === 0 && (
            <TouchableOpacity
              style={styles.inviteHintRow}
              onPress={() => router.push('/settings')}
              activeOpacity={0.7}
            >
              <Ionicons name="person-add-outline" size={14} color={theme.colors.accent} />
              <Text style={styles.inviteHintText}>
                Nobody to split with yet — invite someone in Settings → Household
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.segmented}>
            {(['equal', 'percent', 'amount', 'shares'] as const).map((m) => {
              const active = method === m;
              const label =
                m === 'equal' ? 'Equal' : m === 'percent' ? '%' : m === 'amount' ? '$' : 'Shares';
              return (
                <Pressable
                  key={m}
                  style={[styles.segmentedTab, active && { backgroundColor: theme.colors.accent }]}
                  onPress={() => onMethodChange(m)}
                >
                  <Text style={[styles.segmentedTabText, active && { color: '#fff' }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View>
            <View style={styles.participantRow}>
              <Text style={styles.participantName}>You</Text>
              {method === 'equal' && (
                <Text style={styles.participantValueReadOnly}>
                  {formatCurrency(usesPerItemSplit ? perItemShares.self ?? 0 : yourShare, currencyCode)}
                </Text>
              )}
              {method === 'percent' && (
                <View style={styles.participantInputRow}>
                  <TextInput
                    style={styles.participantInput}
                    value={splitPercents.self ?? ''}
                    onChangeText={(v) => onChangePercent('self', v)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <Text style={styles.participantComputed}>
                    {formatCurrency(((parseFloat(splitPercents.self || '0') || 0) / 100) * totalAmountUsd, currencyCode)}
                  </Text>
                </View>
              )}
              {method === 'amount' && (
                <TextInput
                  style={styles.participantInput}
                  value={splitAmounts.self ?? ''}
                  onChangeText={(v) => onChangeAmount('self', v)}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={theme.colors.textMuted}
                />
              )}
              {method === 'shares' && (
                <View style={styles.participantInputRow}>
                  <TextInput
                    style={styles.participantInput}
                    value={splitShares.self ?? ''}
                    onChangeText={(v) => onChangeShare('self', v)}
                    keyboardType="number-pad"
                    placeholder="1"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <Text style={styles.participantComputed}>
                    {formatCurrency(
                      totalShares > 0 ? ((parseFloat(splitShares.self || '0') || 0) / totalShares) * totalAmountUsd : 0,
                      currencyCode,
                    )}
                  </Text>
                </View>
              )}
            </View>

            {selectedOthers.map((m) => {
              const label = memberLabel(m);
              return (
                <View key={m.uid} style={styles.participantRow}>
                  <Text style={styles.participantName} numberOfLines={1}>{label}</Text>
                  {method === 'equal' && (
                    <Text style={styles.participantValueReadOnly}>
                      {formatCurrency(usesPerItemSplit ? perItemShares[m.uid] ?? 0 : yourShare, currencyCode)}
                    </Text>
                  )}
                  {method === 'percent' && (
                    <View style={styles.participantInputRow}>
                      <TextInput
                        style={styles.participantInput}
                        value={splitPercents[m.uid] ?? ''}
                        onChangeText={(v) => onChangePercent(m.uid, v)}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={theme.colors.textMuted}
                      />
                      <Text style={styles.participantComputed}>
                        {formatCurrency(((parseFloat(splitPercents[m.uid] || '0') || 0) / 100) * totalAmountUsd, currencyCode)}
                      </Text>
                    </View>
                  )}
                  {method === 'amount' && (
                    <TextInput
                      style={styles.participantInput}
                      value={splitAmounts[m.uid] ?? ''}
                      onChangeText={(v) => onChangeAmount(m.uid, v)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={theme.colors.textMuted}
                    />
                  )}
                  {method === 'shares' && (
                    <View style={styles.participantInputRow}>
                      <TextInput
                        style={styles.participantInput}
                        value={splitShares[m.uid] ?? ''}
                        onChangeText={(v) => onChangeShare(m.uid, v)}
                        keyboardType="number-pad"
                        placeholder="1"
                        placeholderTextColor={theme.colors.textMuted}
                      />
                      <Text style={styles.participantComputed}>
                        {formatCurrency(
                          totalShares > 0
                            ? ((parseFloat(splitShares[m.uid] || '0') || 0) / totalShares) * totalAmountUsd
                            : 0,
                          currencyCode,
                        )}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {splitWarning && <Text style={styles.splitWarning}>{splitWarning}</Text>}

          {usesPerItemSplit && (
            <Text style={styles.captionText}>Split by item — some items are shared with fewer people</Text>
          )}

          <Text style={styles.splitSummary}>
            You paid {formatCurrency(totalAmountUsd, currencyCode)} · {formatCurrency(owedToYou, currencyCode)} owed to you
          </Text>
        </View>
      )}
    </Card>
  );
}

function useSplitSectionStyles() {
  return useStyles((t) => ({
    fieldCard: {
      gap: t.spacing.sm,
      borderRadius: t.radius.lg,
    },
    sectionLabel: {
      fontFamily: t.fonts.display.extraBold,
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.8,
    },
    captionText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
    },
    splitToggleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    splitToggleLabel: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '600' as const,
    },
    splitBody: {
      marginTop: t.spacing.md,
      gap: t.spacing.md,
    },
    avatarRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 12,
    },
    avatarWrap: {
      alignItems: 'center' as const,
      gap: 4,
    },
    avatarCircle: {
      width: 40,
      height: 40,
      borderRadius: 999,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: t.colors.surfaceHigh,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    avatarInitial: {
      color: t.colors.textPrimary,
      fontWeight: '700' as const,
      fontSize: t.font.sm,
    },
    avatarLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      maxWidth: 56,
    },
    segmented: {
      flexDirection: 'row' as const,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      overflow: 'hidden' as const,
    },
    segmentedTab: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    segmentedTabText: {
      fontSize: t.font.sm,
      fontWeight: '600' as const,
      color: t.colors.textSecondary,
    },
    participantRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingVertical: 6,
    },
    participantName: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      flex: 1,
    },
    participantValueReadOnly: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
    },
    participantInputRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 4,
    },
    participantInput: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 8,
      paddingVertical: 4,
      width: 60,
      textAlign: 'right' as const,
    },
    participantComputed: {
      fontFamily: t.fonts.mono.regular,
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      minWidth: 56,
      textAlign: 'right' as const,
    },
    splitWarning: {
      color: t.colors.error,
      fontSize: t.font.xs,
    },
    splitSummary: {
      color: t.colors.success,
      fontWeight: '700' as const,
      fontSize: t.font.sm,
      marginTop: t.spacing.xs,
    },
    inviteHintRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      marginTop: 10,
      paddingVertical: 4,
    },
    inviteHintText: {
      flex: 1,
      color: t.colors.accent,
      fontSize: t.font.xs,
      fontFamily: t.fonts.body.regular,
    },
  }));
}
