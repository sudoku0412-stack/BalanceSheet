import { Tabs } from 'expo-router';
import { useNavigationState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { GestureResponderEvent, Pressable, Text, View, ViewStyle } from 'react-native';
import { Theme, useStyles, useTheme } from '../../constants/theme';

function makeTabItemStyles(t: Theme) {
  return {
    tabButton: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    tabItem: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      flexDirection: 'column' as const,
      gap: 4,
    },
    // A wide stadium/pill wrapping ONLY the icon (Material-3 style) —
    // rather than the whole icon+label stack, which is nearly square
    // and so still reads as a rounded square no matter the radius.
    iconPill: {
      width: 52,
      height: 30,
      borderRadius: 15,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      // Android sometimes fails to re-clip a borderRadius'd View's
      // corners when only its backgroundColor changes (e.g. on
      // focus/theme changes) unless overflow is explicitly set —
      // otherwise the highlight briefly (or persistently) paints as a
      // sharp-cornered rectangle instead of a pill.
      overflow: 'hidden' as const,
    },
    iconPillActive: {
      backgroundColor: t.colors.successFaint,
    },
    tabItemLabel: {
      fontFamily: t.fonts.display.medium,
      fontSize: 11,
    },
  };
}

/** Icon + label for a tab, with a pill-shaped highlight behind both
 *  when active — matches the reference design's selected-tab treatment
 *  (a soft background capsule, not just a color change). Implemented
 *  as a full tabBarButton (not tabBarIcon) because React Navigation
 *  sizes the tabBarIcon slot for an icon alone and clips a label added
 *  inside it — a tabBarButton gets the whole tab's tap area instead.
 *  Focus is read via useNavigationState rather than the tabBarButton
 *  props' accessibilityState, which isn't reliably populated here. */
function TabButton({
  name,
  label,
  routeName,
  onPress,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  routeName: string;
  onPress?: (e: GestureResponderEvent) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeTabItemStyles);
  const focused = useNavigationState(
    (state) => state.routes[state.index].name === routeName,
  );
  const color = focused ? theme.colors.success : theme.colors.textMuted;
  return (
    <Pressable onPress={onPress} style={styles.tabButton as ViewStyle}>
      <View style={styles.tabItem}>
        <View style={[styles.iconPill, focused && styles.iconPillActive]}>
          <Ionicons name={name} size={20} color={color} />
        </View>
        <Text style={[styles.tabItemLabel, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export default function TabLayout() {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    tabBar: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 16,
      height: 64,
      borderRadius: 28,
      borderTopWidth: 0,
      backgroundColor: t.colors.surface,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: t.isDark ? 0.45 : 0.14,
      shadowRadius: 14,
      elevation: 8,
    },
    scanButton: {
      width: 56,
      height: 56,
      borderRadius: t.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 26,
      backgroundColor: t.colors.primary,
      borderWidth: 4,
      // In light mode this border matches the tab bar surface, cutting
      // the FAB out as a notch. In dark mode surface/primary are both
      // near-black, so the notch disappears — use borderLight instead
      // so the FAB still reads as a distinct raised shape.
      borderColor: t.isDark ? t.colors.borderLight : t.colors.surface,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 8,
    },
  }));
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: styles.tabBar,
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarButton: (props) => (
            <TabButton
              name="home-outline"
              label="Home"
              routeName="index"
              onPress={props.onPress}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Expenses',
          tabBarButton: (props) => (
            <TabButton
              name="receipt-outline"
              label="Expenses"
              routeName="history"
              onPress={props.onPress}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarShowLabel: false,
          tabBarLabel: () => null,
          tabBarIcon: () => (
            <View style={styles.scanButton}>
              <Ionicons name="camera" size={24} color="#FFFFFF" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="reports-tab"
        options={{
          title: 'Reports',
          tabBarButton: (props) => (
            <TabButton
              name="bar-chart-outline"
              label="Reports"
              routeName="reports-tab"
              onPress={props.onPress}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings-tab"
        options={{
          title: 'Settings',
          tabBarButton: (props) => (
            <TabButton
              name="settings-outline"
              label="Settings"
              routeName="settings-tab"
              onPress={props.onPress}
            />
          ),
        }}
      />
    </Tabs>
  );
}
