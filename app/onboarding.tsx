import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Text,
  View,
  ViewToken,
  useWindowDimensions,
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
  points?: { label: string; badge: 'Free' | 'Premium' }[];
};

const SLIDES: Slide[] = [
  {
    key: 'capture',
    icon: 'camera-outline',
    title: "Snap a receipt, we'll do the rest",
    body: 'Photograph a receipt or pay stub. Amount, merchant, and category land in your ledger — included on Free.',
    accent: 'accent',
  },
  {
    key: 'cashflow',
    icon: 'swap-vertical-outline',
    title: 'Income and spending together',
    body: 'Log paychecks, see earned / spent / net, and open every income on its own page. Budgets and history stay Free.',
    accent: 'success',
  },
  {
    key: 'household',
    icon: 'people-outline',
    title: 'Share one household, free',
    body: 'Invite a partner, split expenses, and settle up. One household is Free. Extra households are Premium.',
    accent: 'accent',
  },
  {
    key: 'plans',
    icon: 'diamond-outline',
    title: 'Free vs Premium',
    body: 'Start Free. Upgrade only if you want more AI scans, exports, or savings goals.',
    accent: 'primary',
    points: [
      { badge: 'Free', label: 'Receipt scan, income, budgets, one household' },
      { badge: 'Free', label: 'Splits, settle up, recurring, All incomes' },
      { badge: 'Premium', label: 'Unlimited AI receipt scanning' },
      { badge: 'Premium', label: 'PDF export, extra households, savings goals' },
    ],
  },
];

export default function OnboardingScreen() {
  const { markOnboardingSeen } = useAuth();
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
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
    setIndex(i);
    try {
      listRef.current?.scrollToIndex({ index: i, animated: true });
    } catch {
      // Tests (and a first-layout race) can miss getItemLayout; index
      // still updates so the CTA / dots stay in sync.
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
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
        <Pressable onPress={finish} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        getItemLayout={(_, i) => ({ length: screenWidth, offset: screenWidth * i, index: i })}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onMomentumScrollEnd={handleScroll}
        renderItem={({ item }) => <SlideView slide={item} width={screenWidth} />}
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
          <Button
            label="Get Started"
            size="lg"
            onPress={finish}
            style={styles.ctaButton}
            textStyle={styles.ctaButtonText}
          />
        ) : (
          <Button
            label="Next"
            size="lg"
            onPress={() => goToSlide(index + 1)}
            style={styles.ctaButton}
            textStyle={styles.ctaButtonText}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function SlideView({ slide, width }: { slide: Slide; width: number }) {
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
    <View style={[styles.slide, { width }]}>
      <View style={styles.decorWrap}>
        <View style={[styles.decorCircleOuter, { backgroundColor: `${tileColor}14` }]} />
        <View style={[styles.decorCircleInner, { backgroundColor: `${tileColor}22` }]} />
        <Animated.View
          style={[
            styles.iconTile,
            {
              backgroundColor: tileColor,
              transform: [{ scale: pulse }],
              shadowColor: tileColor,
            },
          ]}
        >
          <Ionicons name={slide.icon} size={48} color="#fff" />
        </Animated.View>
      </View>
      <Text style={styles.title}>{slide.title}</Text>
      <Text style={styles.body}>{slide.body}</Text>
      {slide.points?.length ? (
        <View style={styles.points}>
          {slide.points.map((point) => (
            <View key={point.label} style={styles.pointRow}>
              <View
                style={[
                  styles.badge,
                  point.badge === 'Premium' ? styles.badgePremium : styles.badgeFree,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    point.badge === 'Premium' ? styles.badgeTextPremium : styles.badgeTextFree,
                  ]}
                >
                  {point.badge}
                </Text>
              </View>
              <Text style={styles.pointLabel}>{point.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
    // 28px keeps the same ~26% radius-to-size ratio as the approved
    // prototype's 82px/22px tile — t.radius.lg (4px) is the stale
    // "mostly-square" token and would regress this to a near-square.
    borderRadius: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: t.isDark ? 0.5 : 0.18,
    shadowRadius: t.isDark ? 16 : 12,
    elevation: t.isDark ? 6 : 3,
  },
  title: {
    color: t.colors.textPrimary,
    fontFamily: t.fonts.display.extraBold,
    fontSize: 26,
    textAlign: 'center' as const,
    marginBottom: t.spacing.md,
    maxWidth: 300,
  },
  body: {
    color: t.colors.textMuted,
    fontFamily: t.fonts.body.regular,
    fontSize: 15,
    textAlign: 'center' as const,
    lineHeight: 22,
    maxWidth: 300,
  },
  points: {
    width: '100%',
    maxWidth: 340,
    marginTop: t.spacing.lg,
    gap: 10,
  },
  pointRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: t.radius.full,
    marginTop: 1,
  },
  badgeFree: {
    backgroundColor: t.colors.successFaint,
  },
  badgePremium: {
    backgroundColor: t.colors.primaryFaint,
  },
  badgeText: {
    fontFamily: t.fonts.display.bold,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  badgeTextFree: { color: t.colors.success },
  badgeTextPremium: { color: t.isDark ? t.colors.tabActive : t.colors.primary },
  pointLabel: {
    flex: 1,
    color: t.colors.textSecondary,
    fontFamily: t.fonts.body.regular,
    fontSize: 13,
    lineHeight: 18,
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
    // Widen into a pill for the active step, matching the prototype's
    // 18px active-dot treatment.
    width: 18,
    backgroundColor: t.colors.success,
    borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.colors.borderLight : 'transparent',
  },
  cta: {
    paddingHorizontal: t.spacing.xl,
    paddingBottom: t.spacing.lg,
  },
  ctaButton: {
    height: 52,
    justifyContent: 'center' as const,
  },
  ctaButtonText: {
    fontSize: 14,
  },
});
