import { tr } from '../../lib/i18n';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Error boundary. Must be a class — React only supports class-based
 * error boundaries (no hook equivalent). Because of that we can't use
 * the `useStyles` hook here, so the error UI uses hardcoded colors
 * picked to be readable on both light and dark backgrounds.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface to console so adb logcat shows it; do not crash.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={styles.root}>
          <Text style={styles.title}>{tr('somethingBrokeOnScreen')}</Text>
          <Text style={styles.msg}>{String(this.state.error?.message ?? this.state.error)}</Text>
          <Text style={styles.stack}>{this.state.error?.stack?.slice(0, 800)}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

// Hardcoded palette: neutral background works on both themes; red title
// for the error label, dark gray monospace body. No theme tokens because
// class components can't use the `useStyles` hook.
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F2937',
    padding: 16,
    gap: 8,
  },
  title: {
    color: '#EF4444',
    fontSize: 17,
    fontWeight: '700',
  },
  msg: {
    color: '#F8FAFC',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  stack: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
