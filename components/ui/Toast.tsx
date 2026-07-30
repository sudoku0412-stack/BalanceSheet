import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Animated, Pressable, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../constants/theme';

type ToastKind = 'info' | 'success' | 'error';

type ToastInput = {
  message: string;
  kind?: ToastKind;
  /** Optional Undo button label. When present + onUndo provided, an
   *  Undo affordance is rendered. Tapping it dismisses the toast and
   *  invokes onUndo. */
  undoLabel?: string;
  onUndo?: () => void;
  /** Auto-dismiss after this many ms. Defaults to 4000 (3 s without
   *  an undo, 5 s with one so the user has time to react). */
  durationMs?: number;
};

type ToastValue = {
  show: (toast: ToastInput) => void;
  dismiss: () => void;
};

const ToastContext = createContext<ToastValue>({
  show: () => {},
  dismiss: () => {},
});

export function useToast(): ToastValue {
  return useContext(ToastContext);
}

/**
 * Wrap the app root with this provider. Any descendant can call
 * useToast().show({...}) to surface a transient message. One toast
 * at a time — a new show() replaces the current one.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastInput | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 20,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [opacity, translateY]);

  const show = useCallback(
    (next: ToastInput) => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setToast(next);
      opacity.setValue(0);
      translateY.setValue(20);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
      const ms = next.durationMs ?? (next.undoLabel ? 5000 : 3000);
      dismissTimer.current = setTimeout(() => dismiss(), ms);
    },
    [dismiss, opacity, translateY],
  );

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      {toast ? (
        <ToastBubble
          toast={toast}
          opacity={opacity}
          translateY={translateY}
          onDismiss={dismiss}
        />
      ) : null}
    </ToastContext.Provider>
  );
}

function ToastBubble({
  toast,
  opacity,
  translateY,
  onDismiss,
}: {
  toast: ToastInput;
  opacity: Animated.Value;
  translateY: Animated.Value;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const kind = toast.kind ?? 'info';
  const accent =
    kind === 'success'
      ? theme.colors.success
      : kind === 'error'
        ? theme.colors.error
        : theme.colors.accent;
  const icon: keyof typeof Ionicons.glyphMap =
    kind === 'success'
      ? 'checkmark-circle'
      : kind === 'error'
        ? 'alert-circle'
        : 'information-circle';
  const wrapperStyle: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    alignItems: 'center',
  };
  return (
    <SafeAreaView pointerEvents="box-none" style={wrapperStyle} edges={['bottom']}>
      <Animated.View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.full,
          paddingVertical: 10,
          paddingHorizontal: theme.spacing.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: theme.isDark ? 0.4 : 0.12,
          shadowRadius: 6,
          elevation: 6,
          opacity,
          transform: [{ translateY }],
          minWidth: 220,
          maxWidth: 480,
        }}
      >
        <Ionicons name={icon} size={18} color={accent} />
        <Text
          style={{
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: theme.font.sm,
            fontWeight: '500',
          }}
          numberOfLines={2}
        >
          {toast.message}
        </Text>
        {toast.undoLabel && toast.onUndo ? (
          <Pressable
            onPress={() => {
              toast.onUndo?.();
              onDismiss();
            }}
            hitSlop={10}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: theme.radius.full,
            }}
          >
            <Text
              style={{
                color: accent,
                fontSize: theme.font.sm,
                fontWeight: '700',
              }}
            >
              {toast.undoLabel}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}
