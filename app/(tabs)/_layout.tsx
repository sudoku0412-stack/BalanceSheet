import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useStyles, useTheme } from '../../constants/theme';

export default function TabLayout() {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    tabBar: {
      backgroundColor: t.colors.surface,
      borderTopColor: t.colors.border,
      borderTopWidth: 1,
      height: 66,
      paddingBottom: 14,
    },
    tabLabel: {
      fontFamily: t.fonts.display.medium,
      fontSize: 11,
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
        // NOT theme.colors.primary — dark navy active-tab icon/label on
        // the dark-mode tab bar (also near-black) is effectively
        // invisible; accent has real contrast in both themes.
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
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
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: () => (
            <View style={styles.scanButton}>
              <Ionicons name="camera" size={24} color="#FFFFFF" />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="reports-tab"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/reports');
          },
        }}
      />
      <Tabs.Screen
        name="settings-tab"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/settings');
          },
        }}
      />
    </Tabs>
  );
}
