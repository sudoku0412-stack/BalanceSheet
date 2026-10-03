import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import {
  clearPendingLinkToken,
  completeBankLink,
  getPendingLinkToken,
  isBankSyncConfigured,
  listBankItems,
  removeBankItem,
  setPendingLinkToken,
  startBankLink,
  syncBankTransactions,
  type BankItem,
} from '../lib/bankSync';
import type { CurrencyCode } from '../lib/currency';
import { useEntitlements } from '../lib/EntitlementsContext';
import { useLanguage, useT } from '../lib/I18nContext';
import { getCurrency } from '../lib/secureStorage';

export default function BankScreen() {
  const t = useT();
  const { language } = useLanguage();
  const theme = useTheme();
  const { isPremium, loading } = useEntitlements();
  const styles = useStyles((th) => ({
    root: { flex: 1, backgroundColor: th.colors.background },
    content: { padding: th.spacing.md, gap: th.spacing.sm, paddingBottom: 48 },
    hint: { color: th.colors.textMuted, fontSize: th.font.sm, fontFamily: th.fonts.body.regular },
    header: {
      color: th.colors.textSecondary,
      fontSize: th.font.xs,
      fontFamily: th.fonts.display.bold,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.8,
    },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    name: { color: th.colors.textPrimary, fontFamily: th.fonts.display.bold, fontSize: th.font.md },
    danger: { color: th.colors.error, fontFamily: th.fonts.body.medium, fontSize: th.font.sm },
    status: { color: th.colors.accent, fontSize: th.font.sm, fontFamily: th.fonts.body.medium },
  }));

  const configured = isBankSyncConfigured();
  const [items, setItems] = useState<BankItem[]>([]);
  const [profileCurrency, setProfileCurrency] = useState<CurrencyCode>('USD');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const checking = useRef(false);

  const reload = useCallback(async () => {
    if (!configured) return;
    try {
      const [list, code] = await Promise.all([listBankItems(), getCurrency()]);
      setItems(list);
      setProfileCurrency((code as CurrencyCode | null) ?? 'USD');
    } catch {
      Alert.alert(t('bankTitle'), t('bankError'));
    }
  }, [configured, t]);

  const runSync = useCallback(async () => {
    setBusy(true);
    try {
      const code = ((await getCurrency()) as CurrencyCode | null) ?? profileCurrency;
      const s = await syncBankTransactions(code);
      const changed = s.imported + s.updated + s.removed;
      const parts: string[] = [];
      parts.push(changed > 0 ? t('bankImportedSummary', { imported: s.imported, updated: s.updated, removed: s.removed }) : t('bankNothingNew'));
      if (s.notReady > 0) parts.push(t('bankNotReady'));
      Alert.alert(
        t('bankTitle'),
        parts.join('\n\n'),
        s.imported > 0
          ? [{ text: t('cancel'), style: 'cancel' }, { text: t('bankReview'), onPress: () => router.push('/review' as never) }]
          : [{ text: t('ok') }],
      );
    } catch {
      Alert.alert(t('bankTitle'), t('bankError'));
    } finally {
      setBusy(false);
    }
  }, [profileCurrency, t]);

  // After the user comes back from the browser, find out whether they finished.
  const checkPendingLink = useCallback(async () => {
    if (checking.current || !configured) return;
    checking.current = true;
    try {
      const token = await getPendingLinkToken();
      if (!token) {
        setWaiting(false);
        return;
      }
      const res = await completeBankLink(token);
      if (res.pending) {
        setWaiting(true);
        return;
      }
      await clearPendingLinkToken();
      setWaiting(false);
      await reload();
      if (res.connected[0]) Alert.alert(t('bankTitle'), t('bankConnectedName', { name: res.connected[0].institution }));
      await runSync();
    } catch {
      // keep the pending token; the next focus/foreground retries
    } finally {
      checking.current = false;
    }
  }, [configured, reload, runSync, t]);

  useFocusEffect(
    useCallback(() => {
      if (!loading && !isPremium) {
        router.replace('/paywall' as never);
        return;
      }
      reload().then(checkPendingLink);
    }, [loading, isPremium, reload, checkPendingLink]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkPendingLink();
    });
    return () => sub.remove();
  }, [checkPendingLink]);

  const connect = async () => {
    setBusy(true);
    try {
      const { linkToken, url } = await startBankLink(language);
      await setPendingLinkToken(linkToken);
      setWaiting(true);
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('bankTitle'), t('bankError'));
    } finally {
      setBusy(false);
    }
  };

  const confirmDisconnect = (item: BankItem) => {
    Alert.alert(t('bankDisconnectTitle', { name: item.institution }), t('bankDisconnectBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('bankDisconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeBankItem(item.itemId);
            await reload();
          } catch {
            Alert.alert(t('bankTitle'), t('bankError'));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title={t('bankTitle')} iconLeading="🏦" onBack={() => router.back()} />
      {!configured ? (
        <EmptyState icon="cloud-offline-outline" title={t('bankTitle')} description={t('bankNotConfigured')} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.hint}>{t('bankIntro')}</Text>
          <Button label={t('bankConnect')} onPress={connect} loading={busy && !items.length} />
          {waiting && (
            <Text style={styles.status} testID="bank-waiting">
              {t('bankLinkPending')}
            </Text>
          )}
          <Text style={styles.header}>{t('bankConnectedHeader')}</Text>
          {items.length === 0 ? (
            <Text style={styles.hint}>{t('bankNone')}</Text>
          ) : (
            <>
              {items.map((item) => (
                <Card key={item.itemId}>
                  <View style={styles.row}>
                    <Text style={styles.name}>{item.institution}</Text>
                    <TouchableOpacity onPress={() => confirmDisconnect(item)} testID={`bank-disconnect-${item.itemId}`}>
                      <Text style={styles.danger}>{t('bankDisconnect')}</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))}
              <Button
                label={busy ? t('bankSyncing') : t('bankSyncNow')}
                onPress={runSync}
                loading={busy}
              />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
