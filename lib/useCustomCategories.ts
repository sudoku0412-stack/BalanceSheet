import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getCurrentHouseholdId } from './database';
import { getCustomCategories, type CustomCategory } from './customCategories';

/** The active household's custom categories, re-read each time the screen
 *  gains focus (Settings can change them while other tabs stay mounted). */
export function useCustomCategories(): CustomCategory[] {
  const [customs, setCustoms] = useState<CustomCategory[]>([]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let hid: string | null = null;
      try {
        hid = getCurrentHouseholdId();
      } catch {
        // database not ready
      }
      if (!hid) return undefined;
      getCustomCategories(hid)
        .then((list) => {
          if (active) setCustoms(list);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []),
  );
  return customs;
}
