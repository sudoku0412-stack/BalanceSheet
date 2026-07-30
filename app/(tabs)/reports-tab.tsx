import { View } from 'react-native';

/**
 * Placeholder route for the "Reports" tab bar button. The actual Reports
 * screen lives at app/reports.tsx (a modal route) — tapping this tab is
 * intercepted in _layout.tsx's tabPress listener before this ever renders.
 */
export default function ReportsTabPlaceholder() {
  return <View />;
}
