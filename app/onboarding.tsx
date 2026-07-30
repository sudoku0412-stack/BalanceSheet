import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Button } from '../components/ui/Button';
import { Theme, useStyles, useTheme } from '../constants/theme';
import { useAuth } from '../lib/AuthContext';

type AccentKey = 'primary' | 'secondary' | 'surfaceTile';

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  accent: AccentKey;
};

const SLIDES: Slide[] = [
  {
    key: 'capture',
    icon: 'camera',
    title: "Snap a receipt, we'll do the rest",
    body: 'Point your camera at any receipt — amount, merchant and category are captured instantly.',
    accent: 'primary',
  },
  {
    key: 'organize',
    icon: 'stats-chart',
    title: 'See where it goes',
    body: 'Track spending by category and stay under budget without lifting a finger.',
    accent: 'secondary',
  },
  {
    key: 'done',
    icon: 'checkmark-circle',
    title: 'One tap, done',
    body: "No forms, no typing. Scan and you're already tracked.",
    accent: 'surfaceTile',
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function OnboardingScreen() {
  const { markOnboardingSeen } = useAuth();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const styles = useStyles(makeStyles);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setIndex(first.index);
    },
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const goToSlide = (i: number) => {
    listRef.current?.scrollToIndex({ index: i, animated: true });
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (i !== index) setIndex(i);
  };

  const finish = async () => {
    await markOnboardingSeen();
    router.replace('/auth');
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        {!isLast && (
          <Pressable onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>SKIP</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onMomentumScrollEnd={handleScroll}
        renderItem={({ item }) => <SlideView slide={item} />}
      />

      <View style={styles.dotsRow}>
        {SLIDES.map((s, i) => (
          <Pressable key={s.key} onPress={() => goToSlide(i)} hitSlop={8}>
            <View style={[styles.dot, i === index && styles.dotActive]} />
          </Pressable>
        ))}
      </View>

      <View style={styles.cta}>
        {isLast ? (
          <Button label="Get started" size="lg" onPress={finish} />
        ) : (
          <Button label="Next" size="lg" onPress={() => goToSlide(index + 1)} />
        )}
      </View>
    </SafeAreaView>
  );
}

function SlideView({ slide }: { slide: Slide }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const tileColor =
    slide.accent === 'surfaceTile'
      ? theme.colors.surfaceHigh
      : slide.accent === 'secondary'
        ? theme.colors.secondary
        : theme.colors.primary;
  return (
    <View style={styles.slide}>
      <View style={[styles.iconTile, { backgroundColor: tileColor }]}>
        <Ionicons name={slide.icon} size={56} color={theme.colors.textPrimary} />
      </View>
      <Text style={styles.title}>{slide.title}</Text>
      <Text style={styles.body}>{slide.body}</Text>
    </View>
  );
}

const makeStyles = (t: Theme) => ({
  container: { flex: 1, backgroundColor: t.colors.background },
  topRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.md,
  },
  skip: {
    color: t.colors.textSecondary,
    fontSize: t.font.sm,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  slide: {
    width: SCREEN_WIDTH,
    paddingHorizontal: t.spacing.xl,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconTile: {
    width: 96,
    height: 96,
    borderRadius: t.radius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: t.spacing.xl,
  },
  title: {
    color: t.colors.textPrimary,
    fontSize: t.font.xxl,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
    marginBottom: t.spacing.md,
  },
  body: {
    color: t.colors.textSecondary,
    fontSize: t.font.md,
    textAlign: 'center' as const,
    lineHeight: 22,
    paddingHorizontal: t.spacing.md,
  },
  dotsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing.sm,
    paddingVertical: t.spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.border,
  },
  dotActive: {
    width: 24,
    backgroundColor: t.colors.primary,
  },
  cta: {
    paddingHorizontal: t.spacing.xl,
    paddingBottom: t.spacing.lg,
  },
});
