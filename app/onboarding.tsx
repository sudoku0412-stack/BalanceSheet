import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
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

type AccentKey = 'accent' | 'success' | 'primary';

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
    accent: 'accent',
  },
  {
    key: 'organize',
    icon: 'stats-chart',
    title: 'See where it goes',
    body: 'Track spending by category and stay under budget without lifting a finger.',
    accent: 'success',
  },
  {
    key: 'done',
    icon: 'checkmark-circle',
    title: 'One tap, done',
    body: "No forms, no typing. Scan and you're already tracked.",
    accent: 'primary',
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function OnboardingScreen() {
  const { markOnboardingSeen } = useAuth();
  const theme = useTheme();
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

  const isFirst = index === 0;
  const isLast = index === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        {!isFirst ? (
          <Pressable onPress={() => goToSlide(index - 1)} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.textSecondary} />
          </Pressable>
        ) : (
          <View />
        )}
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
          <Button label="Get Started" size="lg" onPress={finish} />
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
  const tileColor = theme.colors[slide.accent];

  // Slow ambient "breathe" scale-pulse — the one deliberate decorative
  // animation flourish called for on the onboarding icon tile.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.slide}>
      <View style={styles.decorWrap}>
        <View style={[styles.decorCircleOuter, { backgroundColor: `${tileColor}14` }]} />
        <View style={[styles.decorCircleInner, { backgroundColor: `${tileColor}22` }]} />
        <Animated.View
          style={[styles.iconTile, { backgroundColor: tileColor, transform: [{ scale: pulse }] }]}
        >
          <Ionicons name={slide.icon} size={48} color="#fff" />
        </Animated.View>
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
    justifyContent: 'space-between' as const,
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.md,
  },
  skip: {
    color: t.colors.textSecondary,
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.sm,
    letterSpacing: 0.5,
  },
  slide: {
    width: SCREEN_WIDTH,
    paddingHorizontal: t.spacing.xl,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  decorWrap: {
    width: 220,
    height: 220,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: t.spacing.xl,
  },
  decorCircleOuter: {
    position: 'absolute' as const,
    width: 220,
    height: 220,
    borderRadius: t.radius.full,
  },
  decorCircleInner: {
    position: 'absolute' as const,
    width: 160,
    height: 160,
    borderRadius: t.radius.full,
  },
  iconTile: {
    width: 108,
    height: 108,
    borderRadius: t.radius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  title: {
    color: t.colors.textPrimary,
    fontFamily: t.fonts.display.extraBold,
    fontSize: 26,
    textAlign: 'center' as const,
    marginBottom: t.spacing.md,
    maxWidth: 280,
  },
  body: {
    color: t.colors.textSecondary,
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.md,
    textAlign: 'center' as const,
    lineHeight: 22,
    maxWidth: 280,
  },
  dotsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing.sm,
    paddingVertical: t.spacing.lg,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: t.radius.full,
    backgroundColor: t.colors.border,
  },
  dotActive: {
    width: 6,
    backgroundColor: t.colors.primary,
  },
  cta: {
    paddingHorizontal: t.spacing.xl,
    paddingBottom: t.spacing.lg,
  },
});
