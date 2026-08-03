import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/theme';
import type { ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

// ── Inner class catches errors; outer function provides theme ─────────────────

interface ClassProps {
  children: React.ReactNode;
  colors: ColorPalette;
  onReset: () => void;
}

interface ClassState {
  error: Error | null;
}

class ErrorBoundaryClass extends React.Component<ClassProps, ClassState> {
  state: ClassState = { error: null };

  static getDerivedStateFromError(error: Error): ClassState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { colors, onReset } = this.props;
    const s = makeStyles(colors);

    return (
      <View style={s.root}>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.message}>{error.message}</Text>
        <Pressable
          style={({ pressed }) => [s.button, pressed && s.pressed]}
          onPress={onReset}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={s.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

// ── Public functional wrapper ─────────────────────────────────────────────────

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const [key, setKey] = useState(0);

  return (
    <ErrorBoundaryClass
      key={key}
      colors={colors}
      onReset={() => setKey((k) => k + 1)}
    >
      {children}
    </ErrorBoundaryClass>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 20,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 22,
    color: colors.t1,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.t2,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    backgroundColor: colors.teal,
  },
  pressed: { opacity: 0.7 },
  buttonText: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: 14,
    color: colors.bg,
    letterSpacing: 0.5,
  },
});
