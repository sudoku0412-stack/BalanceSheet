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

export default function ScanPaystubScreen() {
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
        'Could not read pay stub',
        'No net pay or employer found. Enter the income manually.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add manually', onPress: () => router.replace('/add-income' as never) },
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
        Alert.alert('OCR Failed', 'Could not read any text. Try a sharper photo or enter manually.');
        return;
      }
      goToAddIncome(rawText);
    } catch (e) {
      Alert.alert('OCR Failed', (e as Error)?.message ?? 'Could not read the pay stub.');
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
      Alert.alert('Camera needed', 'Allow camera access to photograph a pay stub.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!result.canceled && result.assets[0]?.uri) {
      await recognize(result.assets[0].uri);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title="Scan pay stub" iconLeading="📄" />
      <View style={styles.body}>
        <Card style={{ gap: theme.spacing.sm }}>
          <Text style={styles.hint}>
            Photograph or pick a pay stub. We read net pay, pay date, and employer
            with on-device OCR, then open Add Income so you can confirm before
            saving. Amounts stay in your profile currency.
          </Text>
          <Button label="Take photo" onPress={takePhoto} loading={busy} size="lg" />
          <Button
            label="Choose from photos"
            onPress={pickFromLibrary}
            loading={busy}
            variant="secondary"
            size="lg"
          />
          <Button
            label="Enter manually"
            onPress={() => router.replace('/add-income' as never)}
            variant="ghost"
          />
        </Card>
        {rawPreview ? <Text style={styles.preview}>{rawPreview}</Text> : null}
      </View>
    </SafeAreaView>
  );
}
