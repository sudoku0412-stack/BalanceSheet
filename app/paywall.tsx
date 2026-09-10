import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { PurchasesPackage } from 'react-native-purchases';
import { PACKAGE_TYPE } from 'react-native-purchases';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { LegalLinksRow } from '../components/ui/LegalLinksRow';
import { useToast } from '../components/ui/Toast';
import { useStyles, useTheme, Theme } from '../constants/theme';
import { useEntitlements } from '../lib/EntitlementsContext';

const FEATURES = [
  { icon: 'sparkles' as const, label: 'Unlimited AI receipt scanning' },
  { icon: 'document-text' as const, label: 'Export reports as PDF' },
  { icon: 'people' as const, label: 'Create or join multiple households' },
];

/**
 * Full-screen upgrade sheet — reached from Settings' "Upgrade" row and
 * from any of the three gates (AI-parse quota, PDF export, multi-
 * household) that redirect here instead of dead-ending. Household
 * SHARING itself is free; this only covers AI quota, export, and
 * belonging to more than one household at a time.
 */
export default function PaywallScreen() {
  const theme = useTheme();
  const styles = usePaywallStyles();
  const toast = useToast();
  const { isPremium, offerings, refreshOfferings, purchasePackage, restorePurchases } = useEntitlements();

  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await refreshOfferings();
      } finally {
        setLoadingOfferings(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isPremium) {
      toast.show({ kind: 'success', message: "You're on Premium — thanks for supporting the app!" });
      router.back();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium]);

  const packages = offerings?.current?.availablePackages ?? [];
  // Annual first — it's the better deal and the one we want most
  // visible, matching how the pricing was decided (≈2.5 months free
  // vs. paying monthly).
  const sortedPackages = [...packages].sort((a, b) => {
    const rank = (p: PurchasesPackage) => (p.packageType === PACKAGE_TYPE.ANNUAL ? 0 : 1);
    return rank(a) - rank(b);
  });

  const onPurchase = async (pkg: PurchasesPackage) => {
    if (purchasingId) return;
    setPurchasingId(pkg.identifier);
    try {
      const outcome = await purchasePackage(pkg);
      if (!outcome.ok) {
        if (!outcome.userCancelled) {
          toast.show({ kind: 'error', message: outcome.message });
        }
        return;
      }
      // Success path (isPremium becoming true) is handled by the
      // effect above, which shows its own toast and navigates back.
    } finally {
      setPurchasingId(null);
    }
  };

  const onRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const premium = await restorePurchases();
      if (!premium) {
        toast.show({ kind: 'error', message: 'No active subscription found for this account.' });
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't restore purchases." });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title="Upgrade to Premium" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <View style={styles.featureIconWrap}>
                <Ionicons name={f.icon} size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        {loadingOfferings ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loading} />
        ) : sortedPackages.length === 0 ? (
          <Text style={styles.errorText}>
            Plans aren't available right now — check your connection and try again shortly.
          </Text>
        ) : (
          <View style={styles.plans}>
            {sortedPackages.map((pkg) => {
              const isAnnual = pkg.packageType === PACKAGE_TYPE.ANNUAL;
              const hasTrial = pkg.product.introPrice != null;
              return (
                <View key={pkg.identifier} style={styles.planCard}>
                  <View style={styles.planHeaderRow}>
                    <Text style={styles.planTitle}>{isAnnual ? 'Annual' : 'Monthly'}</Text>
                    {isAnnual && <Text style={styles.planBadge}>BEST VALUE</Text>}
                  </View>
                  <Text style={styles.planPrice}>{pkg.product.priceString}</Text>
                  {hasTrial && <Text style={styles.planTrial}>Includes free trial</Text>}
                  <Button
                    label={purchasingId === pkg.identifier ? 'Processing…' : hasTrial ? 'Start free trial' : 'Subscribe'}
                    onPress={() => onPurchase(pkg)}
                    loading={purchasingId === pkg.identifier}
                    disabled={purchasingId !== null}
                    size="lg"
                    style={styles.planButton}
                  />
                </View>
              );
            })}
          </View>
        )}

        <Button
          label={restoring ? 'Restoring…' : 'Restore purchases'}
          onPress={onRestore}
          variant="ghost"
          loading={restoring}
          disabled={purchasingId !== null || restoring}
          style={styles.restoreButton}
        />

        <Text style={styles.legalText}>
          Subscriptions renew automatically until cancelled — manage or cancel anytime from your
          Google Play or App Store account settings.
        </Text>
        <LegalLinksRow />
      </ScrollView>
    </SafeAreaView>
  );
}

function usePaywallStyles() {
  return useStyles((t: Theme) => ({
    screen: { flex: 1, backgroundColor: t.colors.background },
    scroll: {
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.lg,
      paddingBottom: t.spacing.xl,
      gap: t.spacing.lg,
    },
    featureList: { gap: t.spacing.sm },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
    featureIconWrap: {
      width: 32,
      height: 32,
      borderRadius: t.radius.full,
      backgroundColor: `${t.colors.accent}18`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureLabel: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.md,
      flex: 1,
    },
    loading: { marginTop: t.spacing.xl },
    errorText: {
      color: t.colors.textMuted,
      fontSize: t.font.sm,
      textAlign: 'center',
      marginTop: t.spacing.lg,
    },
    plans: { gap: t.spacing.md },
    planCard: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: t.spacing.md,
    },
    planHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    planTitle: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.lg,
    },
    planBadge: {
      color: t.colors.accent,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.xs,
      letterSpacing: 0.5,
    },
    planPrice: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.extraBold,
      fontSize: t.font.xxl,
      marginTop: t.spacing.xs,
    },
    planTrial: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      marginTop: 2,
    },
    planButton: { marginTop: t.spacing.sm },
    restoreButton: { alignSelf: 'center' },
    legalText: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      textAlign: 'center',
      lineHeight: 18,
    },
  }));
}
