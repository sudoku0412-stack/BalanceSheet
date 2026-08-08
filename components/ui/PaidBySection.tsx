import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useStyles, useTheme } from '../../constants/theme';
import { Card } from './Card';
import { HouseholdMember } from '../../lib/cloudSync';
import { tapLight } from '../../lib/haptics';

function memberLabel(m: HouseholdMember): string {
  return m.displayName?.trim() || m.email?.trim() || 'Member';
}

function initialFor(label: string): string {
  const trimmed = label.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

/**
 * Top-level "who actually paid" picker — independent of whether this
 * expense is being split with anyone. Splitwise separates these two
 * questions (who fronted the money vs. how it's divided up); this app's
 * SplitSection used to only surface a payer picker once split was
 * enabled AND at least one other participant was selected, which meant
 * "I logged this personal expense but my roommate actually paid for it"
 * had no way to be recorded. Rendered whenever the household has other
 * members — irrelevant, and hidden, in a single-user household.
 */
export function PaidBySection(props: {
  otherMembers: HouseholdMember[];
  paidBy: string;
  onPaidByChange: (uid: string) => void;
}) {
  const theme = useTheme();
  const styles = usePaidBySectionStyles();
  const { otherMembers, paidBy, onPaidByChange } = props;

  if (otherMembers.length === 0) return null;

  const select = (uid: string) => {
    tapLight();
    onPaidByChange(uid);
  };

  return (
    <Card style={styles.fieldCard}>
      <Text style={styles.sectionLabel}>PAID BY</Text>
      <View style={styles.avatarRow}>
        <TouchableOpacity style={styles.avatarWrap} onPress={() => select('self')} activeOpacity={0.7}>
          <View
            style={[
              styles.avatarCircle,
              { borderColor: paidBy === 'self' ? theme.colors.accent : 'transparent', opacity: paidBy === 'self' ? 1 : 0.35 },
            ]}
          >
            <Text style={styles.avatarInitial}>Y</Text>
          </View>
          <Text style={styles.avatarLabel} numberOfLines={1}>You</Text>
        </TouchableOpacity>
        {otherMembers.map((m) => {
          const label = memberLabel(m);
          const active = paidBy === m.uid;
          return (
            <TouchableOpacity key={m.uid} style={styles.avatarWrap} onPress={() => select(m.uid)} activeOpacity={0.7}>
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
    </Card>
  );
}

function usePaidBySectionStyles() {
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
  }));
}
