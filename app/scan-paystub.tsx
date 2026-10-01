import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useStyles, useTheme } from '../constants/theme';
import { parsePaystubText } from '../lib/paystubParse';

import { useT } from '../lib/I18nContext';
export default function ScanPaystubScreen() {
  const t = useT();
  const theme = useTheme();
  const styles = useStyles((t) => ({
    root: { flex: 1, backgroundColor: t.colors.background },
    body: { padding: t.spacing.md, gap: t.spacing.md },
    hint: {
      color: t.colors.textSecondary,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.sm,
      lineHeight: 20,
    },
    preview: {
      color: t.colors.textMuted,
      fontFamily: t.fonts.mono.regular,
      fontSize: t.font.xs,
    },
  }));

  const [busy, setBusy] = useState(false);
  const [rawPreview, setRawPreview] = useState<string | null>(null);

  const goToAddIncome = (rawText: string) => {
    const parsed = parsePaystubText(rawText);
    if (parsed.amount == null && !parsed.sourceName) {
      Alert.alert(
        t('couldNotReadPayStub'),
        t('noNetPayOrEmployer'),
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('addManually'), onPress: () => router.replace('/add-income' as never) },
        ],
      );
      return;
    }
    router.replace({
      pathname: '/add-income',
      params: {
        amount: parsed.amount != null ? parsed.amount.toFixed(2) : '',
        date: parsed.date ?? '',
        sourceName: parsed.sourceName,
        category: parsed.category,
        notes: parsed.notes ?? '',
      },
    } as never);
  };

  const recognize = async (uri: string) => {
    setBusy(true);
    try {
      const ocr = await TextRecognition.recognize(uri);
      const lines: string[] = ocr.blocks.flatMap((block) =>
        block.lines.map((line) => line.text),
      );
      const rawText = lines.join('\n');
      setRawPreview(rawText.slice(0, 400));
      if (!rawText.trim()) {
        Alert.alert(t('ocrFailed'), t('couldNotReadAnyText'));
        return;
      }
      goToAddIncome(rawText);
    } catch (e) {
      Alert.alert(t('ocrFailed'), (e as Error)?.message ?? t('couldNotReadThePay'));
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      await recognize(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('cameraNeeded'), t('allowCameraAccessToPhotograph'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!result.canceled && result.assets[0]?.uri) {
      await recognize(result.assets[0].uri);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title={t('scanPayStub')} iconLeading="📄" />
      <View style={styles.body}>
        <Card style={{ gap: theme.spacing.sm }}>
          <Text style={styles.hint}>
            {t('photographOrPickAPay')}
          </Text>
          <Button label={t('takePhoto')} onPress={takePhoto} loading={busy} size="lg" />
          <Button
            label={t('chooseFromPhotos')}
            onPress={pickFromLibrary}
            loading={busy}
            variant="secondary"
            size="lg"
          />
          <Button
            label={t('enterManually')}
            onPress={() => router.replace('/add-income' as never)}
            variant="ghost"
          />
        </Card>
        {rawPreview ? <Text style={styles.preview}>{rawPreview}</Text> : null}
      </View>
    </SafeAreaView>
  );
}
