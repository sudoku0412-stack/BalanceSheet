import { View } from 'react-native';

/**
 * Placeholder route for the "Settings" tab bar button. The actual Settings
 * screen lives at app/settings.tsx (a modal route) — tapping this tab is
 * intercepted in _layout.tsx's tabPress listener before this ever renders.
 */
export default function SettingsTabPlaceholder() {
  return <View />;
}
