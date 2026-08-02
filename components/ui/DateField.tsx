import React, { useState } from 'react';
import { Modal, Platform, Pressable, Text, TextInput, ViewStyle } from 'react-native';
import { format } from 'date-fns';
import { useStyles, useTheme } from '../../constants/theme';
import { parseYmdLocal } from '../../lib/parser';
import { Button } from './Button';

/**
 * @react-native-community/datetimepicker is a native module — the
 * currently installed binary on a device may predate this feature and
 * not have it linked yet (needs a fresh native rebuild, same as
 * expo-camera/expo-contacts before it — see HANDOVER.md). A top-level
 * `import` resolves the native module as soon as ANY screen importing
 * this file loads, crashing that screen outright on an un-rebuilt
 * binary. Lazy-require it instead (mirrors lib/contactPicker.ts) so the
 * field just falls back to a plain typed YYYY-MM-DD input until rebuilt.
 */
type DateTimePickerModule = typeof import('@react-native-community/datetimepicker');
let cachedPicker: DateTimePickerModule | null | undefined;

function loadDateTimePicker(): DateTimePickerModule | null {
  if (cachedPicker !== undefined) return cachedPicker;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    cachedPicker = require('@react-native-community/datetimepicker') as DateTimePickerModule;
  } catch {
    cachedPicker = null;
  }
  return cachedPicker;
}

/** A YYYY-MM-DD text field that opens the OS's native calendar/date
 *  picker on tap instead of requiring the digits to be typed by hand.
 *  Falls back to a plain editable text input if the native module
 *  isn't linked yet on this install. */
export function DateField({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const styles = useDateFieldStyles();
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState<Date>(parseYmdLocal(value) ?? new Date());
  const PickerModule = loadDateTimePicker();

  if (!PickerModule) {
    return (
      <TextInput
        style={[styles.input, style as object]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
      />
    );
  }
  const DateTimePicker = PickerModule.default;

  const openPicker = () => {
    setDraft(parseYmdLocal(value) ?? new Date());
    setShowPicker(true);
  };

  // Android's picker is a self-contained modal dialog — it fires once
  // and reports whether the user confirmed ('set') or backed out
  // ('dismissed'), so it's safe to hide immediately either way.
  const handleAndroidChange = (event: { type: string }, selected?: Date) => {
    setShowPicker(false);
    if (event.type === 'set' && selected) {
      onChange(format(selected, 'yyyy-MM-dd'));
    }
  };

  // iOS's inline calendar stays mounted and fires on every tap, so the
  // chosen date is only committed via the "Done" button below.
  const handleIosChange = (_event: unknown, selected?: Date) => {
    if (selected) setDraft(selected);
  };

  const confirmIos = () => {
    onChange(format(draft, 'yyyy-MM-dd'));
    setShowPicker(false);
  };

  const displayDate = parseYmdLocal(value);

  return (
    <>
      <Pressable style={[styles.input, style]} onPress={openPicker}>
        <Text style={displayDate ? styles.valueText : styles.placeholderText}>
          {displayDate ? format(displayDate, 'MMM d, yyyy') : placeholder ?? 'Select date'}
        </Text>
      </Pressable>

      {showPicker && Platform.OS === 'android' && (
        <DateTimePicker value={draft} mode="date" display="default" onChange={handleAndroidChange} />
      )}

      {showPicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
          <Pressable style={styles.overlay} onPress={() => setShowPicker(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <DateTimePicker
                value={draft}
                mode="date"
                display="inline"
                onChange={handleIosChange}
                themeVariant={theme.isDark ? 'dark' : 'light'}
              />
              <Button label="Done" onPress={confirmIos} style={styles.doneBtn} />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

function useDateFieldStyles() {
  return useStyles((t) => ({
    input: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
      justifyContent: 'center' as const,
    },
    valueText: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
    },
    placeholderText: {
      color: t.colors.textMuted,
      fontSize: t.font.md,
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    sheet: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      padding: t.spacing.md,
      width: '90%' as const,
    },
    doneBtn: {
      marginTop: t.spacing.sm,
    },
  }));
}
