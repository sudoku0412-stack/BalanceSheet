import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useStyles } from '../../constants/theme';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../../lib/legalLinks';

/** Privacy Policy / Terms of Service link row — shared by the auth
 *  screen and Settings so the two don't drift out of sync with each
 *  other (they previously duplicated this styling verbatim). */
export function LegalLinksRow() {
  const styles = useLegalLinksStyles();
  return (
    <View style={styles.row}>
      <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} hitSlop={4}>
        <Text style={styles.link}>Privacy Policy</Text>
      </Pressable>
      <Text style={styles.divider}>·</Text>
      <Pressable onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)} hitSlop={4}>
        <Text style={styles.link}>Terms of Service</Text>
      </Pressable>
    </View>
  );
}

function useLegalLinksStyles() {
  return useStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: theme.spacing.sm,
    },
    link: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.regular,
      textDecorationLine: 'underline' as const,
    },
    divider: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
    },
  }));
}
