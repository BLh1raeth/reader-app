import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { Slider } from '@expo/ui/community/slider';
import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import {
  DEFAULT_READER_SETTINGS,
  READER_SETTINGS_LIMITS,
  readerSettingsEqual,
  type ReaderAppearance,
  type ReaderSettings,
} from './reader-settings';

type Props = {
  isPresented: boolean;
  onChange: (settings: ReaderSettings) => void;
  onDismissed: () => void;
  onRequestDismiss: () => void;
  onReset: () => void;
  settings: ReaderSettings;
};

type SettingSliderProps = {
  accessibilityLabel: string;
  icon: 'line.3.horizontal' | 'rectangle.portrait' | 'textformat';
  maximumValue: number;
  minimumValue: number;
  onValueChange: (value: number) => void;
  primaryColor: string;
  secondaryColor: string;
  trackColor: string;
  valueLabel: string;
  value: number;
};

function SettingSlider({
  accessibilityLabel,
  icon,
  maximumValue,
  minimumValue,
  onValueChange,
  primaryColor,
  secondaryColor,
  trackColor,
  valueLabel,
  value,
}: SettingSliderProps) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.sliderRow}>
      <View style={styles.sliderIconContainer}>
        <SymbolView name={icon} size={21} tintColor={primaryColor} weight="medium" />
      </View>
      <Slider
        maximumValue={maximumValue}
        maximumTrackTintColor={trackColor}
        minimumTrackTintColor={primaryColor}
        minimumValue={minimumValue}
        onValueChange={onValueChange}
        style={styles.slider}
        value={value}
      />
      <Text style={[styles.sliderValue, { color: secondaryColor }]}>{valueLabel}</Text>
    </View>
  );
}

function SettingsControlSurface({
  appearance,
  children,
  interactive = true,
  style,
}: {
  appearance: ReaderAppearance;
  children: ReactNode;
  interactive?: boolean;
  style: StyleProp<ViewStyle>;
}) {
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView colorScheme={appearance} glassEffectStyle="regular" isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        style,
        { backgroundColor: appearance === 'dark' ? 'rgba(58,58,60,0.78)' : 'rgba(250,250,252,0.78)' },
      ]}
    >
      {children}
    </View>
  );
}

function FontLevelDot({
  activeColor,
  inactiveColor,
  index,
  level,
}: {
  activeColor: string;
  inactiveColor: string;
  index: number;
  level: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      level.get(),
      [index - 1, index],
      [inactiveColor, activeColor],
      'RGB',
      { gamma: 2.2 },
    ),
  }));
  return <Animated.View style={[styles.fontLevelDot, animatedStyle]} />;
}

export function ReaderSettingsSheet({
  isPresented,
  onChange,
  onDismissed,
  onRequestDismiss,
  onReset,
  settings,
}: Props) {
  const insets = useSafeAreaInsets();
  const isDefault = readerSettingsEqual(settings, DEFAULT_READER_SETTINGS);
  const isDark = settings.appearance === 'dark';
  const primaryColor = isDark ? '#f2f2f7' : '#1c1c1e';
  const secondaryColor = isDark ? 'rgba(235,235,245,0.60)' : 'rgba(60,60,67,0.60)';
  const trackColor = isDark ? 'rgba(235,235,245,0.20)' : 'rgba(60,60,67,0.18)';
  const separatorColor = isDark ? 'rgba(235,235,245,0.14)' : 'rgba(60,60,67,0.16)';
  const fontLevelCount = Math.round(
    (READER_SETTINGS_LIMITS.fontSize.max - READER_SETTINGS_LIMITS.fontSize.min)
      / READER_SETTINGS_LIMITS.fontSize.step,
  ) + 1;
  const activeFontLevel = Math.round(
    (settings.fontSize - READER_SETTINGS_LIMITS.fontSize.min) / READER_SETTINGS_LIMITS.fontSize.step,
  );
  const fontLevelOpacity = useSharedValue(0);
  const fontLevelProgress = useSharedValue(activeFontLevel);
  const fontLevelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontLevelStyle = useAnimatedStyle(() => ({ opacity: fontLevelOpacity.get() }));
  const revealFontLevels = () => {
    if (fontLevelTimerRef.current) clearTimeout(fontLevelTimerRef.current);
    fontLevelOpacity.set(withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) }));
    fontLevelTimerRef.current = setTimeout(() => {
      fontLevelTimerRef.current = null;
      fontLevelOpacity.set(withTiming(0, { duration: 220, easing: Easing.inOut(Easing.cubic) }));
    }, 2200);
  };
  useEffect(() => () => {
    if (fontLevelTimerRef.current) clearTimeout(fontLevelTimerRef.current);
  }, []);
  useEffect(() => {
    fontLevelProgress.set(withTiming(activeFontLevel, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    }));
  }, [activeFontLevel, fontLevelProgress]);
  const update = <Key extends keyof ReaderSettings>(key: Key, value: ReaderSettings[Key]) => {
    onChange({ ...settings, [key]: value });
  };
  const changeFontSize = (delta: number) => {
    const nextValue = Math.max(
      READER_SETTINGS_LIMITS.fontSize.min,
      Math.min(READER_SETTINGS_LIMITS.fontSize.max, settings.fontSize + delta),
    );
    revealFontLevels();
    update('fontSize', nextValue);
  };
  const transitionActions: MenuAction[] = [
    { id: 'dissolve', title: uiText.settings.dissolve, state: settings.pageTransition === 'dissolve' ? 'on' : 'off' },
  ];
  const appearanceActions: MenuAction[] = [
    { id: 'light', title: uiText.settings.light, state: settings.appearance === 'light' ? 'on' : 'off' },
    { id: 'dark', title: uiText.settings.dark, state: settings.appearance === 'dark' ? 'on' : 'off' },
  ];

  return (
    <Host pointerEvents="none" style={styles.sheetHost}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismissed}
        onIsPresentedChange={(presented) => {
          if (!presented) onRequestDismiss();
        }}
      >
        <Group modifiers={[
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
          presentationDetents(['medium']),
          presentationDragIndicator('hidden'),
          presentationBackground('transparent'),
        ]}>
          <RNHostView>
            <View style={styles.sheetContent}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView
                  colorScheme={settings.appearance}
                  glassEffectStyle="clear"
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { bottom: -insets.bottom }]}
                />
              ) : (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    styles.sheetGlassFallback,
                    { backgroundColor: isDark ? 'rgba(24,24,27,0.88)' : 'rgba(246,246,250,0.82)', bottom: -insets.bottom },
                  ]}
                />
              )}

              <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <Text style={[styles.title, { color: primaryColor }]}>{uiText.settings.title}</Text>

                <View style={styles.quickControls}>
                  <View style={styles.fontSizeStack}>
                    <SettingsControlSurface appearance={settings.appearance} interactive={false} style={styles.fontSizeControl}>
                      <Pressable
                        accessibilityLabel={uiText.settings.decreaseFont}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: settings.fontSize <= READER_SETTINGS_LIMITS.fontSize.min }}
                        disabled={settings.fontSize <= READER_SETTINGS_LIMITS.fontSize.min}
                        onPress={() => changeFontSize(-READER_SETTINGS_LIMITS.fontSize.step)}
                        style={[
                          styles.fontSizeButton,
                          settings.fontSize <= READER_SETTINGS_LIMITS.fontSize.min ? styles.controlDisabled : null,
                        ]}
                      >
                        {({ pressed }) => (
                          <Text style={[
                            styles.fontSizeMinus,
                            { color: primaryColor },
                            pressed ? styles.fontGlyphPressed : null,
                          ]}>A−</Text>
                        )}
                      </Pressable>
                      <View pointerEvents="none" style={[styles.controlDivider, { backgroundColor: separatorColor }]} />
                      <Pressable
                        accessibilityLabel={uiText.settings.increaseFont}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: settings.fontSize >= READER_SETTINGS_LIMITS.fontSize.max }}
                        disabled={settings.fontSize >= READER_SETTINGS_LIMITS.fontSize.max}
                        onPress={() => changeFontSize(READER_SETTINGS_LIMITS.fontSize.step)}
                        style={[
                          styles.fontSizeButton,
                          settings.fontSize >= READER_SETTINGS_LIMITS.fontSize.max ? styles.controlDisabled : null,
                        ]}
                      >
                        {({ pressed }) => (
                          <Text style={[
                            styles.fontSizePlus,
                            { color: primaryColor },
                            pressed ? styles.fontGlyphPressed : null,
                          ]}>A+</Text>
                        )}
                      </Pressable>
                    </SettingsControlSurface>
                    <Animated.View
                      accessibilityElementsHidden
                      pointerEvents="none"
                      style={[styles.fontLevelIndicator, fontLevelStyle]}
                    >
                      {Array.from({ length: fontLevelCount }, (_, index) => (
                        <FontLevelDot
                          activeColor={primaryColor}
                          inactiveColor={trackColor}
                          index={index}
                          key={index}
                          level={fontLevelProgress}
                        />
                      ))}
                    </Animated.View>
                  </View>

                  <View style={styles.modeGroup}>
                    <MenuView
                      actions={transitionActions}
                      onPressAction={() => update('pageTransition', 'dissolve')}
                      style={styles.modeMenu}
                    >
                      <SettingsControlSurface appearance={settings.appearance} style={styles.modeCircle}>
                        <View accessibilityLabel={uiText.settings.pageTurnMode} accessibilityRole="button" style={styles.modeButton}>
                          <SymbolView name="square.stack.3d.up" size={20} tintColor={primaryColor} weight="medium" />
                        </View>
                      </SettingsControlSurface>
                    </MenuView>
                    <MenuView
                      actions={appearanceActions}
                      onPressAction={(event) => update('appearance', event.nativeEvent.event === 'dark' ? 'dark' : 'light')}
                      style={styles.modeMenu}
                    >
                      <SettingsControlSurface appearance={settings.appearance} style={styles.modeCircle}>
                        <View accessibilityLabel={uiText.settings.appearanceMode} accessibilityRole="button" style={styles.modeButton}>
                          <SymbolView
                            name={settings.appearance === 'dark' ? 'circle.righthalf.filled' : 'circle.lefthalf.filled'}
                            size={20}
                            tintColor={primaryColor}
                            weight="medium"
                          />
                        </View>
                      </SettingsControlSurface>
                    </MenuView>
                  </View>
                </View>

                <View style={styles.metricsGroup}>
                  <View style={styles.metricRow}>
                    <Text style={[styles.settingLabel, { color: primaryColor }]}>{uiText.settings.lineHeight}</Text>
                    <SettingSlider
                      accessibilityLabel={uiText.settings.lineHeight}
                      icon="line.3.horizontal"
                      maximumValue={READER_SETTINGS_LIMITS.lineHeight.max}
                      minimumValue={READER_SETTINGS_LIMITS.lineHeight.min}
                      onValueChange={(value) => update('lineHeight', value)}
                      primaryColor={primaryColor}
                      secondaryColor={secondaryColor}
                      trackColor={trackColor}
                      value={settings.lineHeight}
                      valueLabel={settings.lineHeight.toFixed(2)}
                    />
                  </View>

                  <View style={styles.metricRow}>
                    <Text style={[styles.settingLabel, { color: primaryColor }]}>{uiText.settings.letterSpacing}</Text>
                    <SettingSlider
                      accessibilityLabel={uiText.settings.letterSpacing}
                      icon="textformat"
                      maximumValue={READER_SETTINGS_LIMITS.letterSpacing.max}
                      minimumValue={READER_SETTINGS_LIMITS.letterSpacing.min}
                      onValueChange={(value) => update('letterSpacing', value)}
                      primaryColor={primaryColor}
                      secondaryColor={secondaryColor}
                      trackColor={trackColor}
                      value={settings.letterSpacing}
                      valueLabel={`${Math.round(settings.letterSpacing * 100)}%`}
                    />
                  </View>

                  <View style={[styles.metricSeparator, { backgroundColor: separatorColor }]} />

                  <View style={styles.metricRow}>
                    <Text style={[styles.settingLabel, { color: primaryColor }]}>{uiText.settings.pageMargin}</Text>
                    <SettingSlider
                      accessibilityLabel={uiText.settings.pageMargin}
                      icon="rectangle.portrait"
                      maximumValue={READER_SETTINGS_LIMITS.pageMargin.max}
                      minimumValue={READER_SETTINGS_LIMITS.pageMargin.min}
                      onValueChange={(value) => update('pageMargin', value)}
                      primaryColor={primaryColor}
                      secondaryColor={secondaryColor}
                      trackColor={trackColor}
                      value={settings.pageMargin}
                      valueLabel={`${settings.pageMargin.toFixed(1).replace('.0', '')}%`}
                    />
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  disabled={isDefault}
                  onPress={onReset}
                  style={({ pressed }) => [styles.resetButton, pressed && !isDefault ? styles.resetButtonPressed : null]}
                >
                  <Text style={[
                    styles.resetText,
                    { color: isDefault ? secondaryColor : primaryColor },
                  ]}>{uiText.settings.reset}</Text>
                </Pressable>
              </View>
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  sheetHost: { position: 'absolute' },
  sheetContent: { flexGrow: 1, height: 0 },
  sheetGlassFallback: {},
  content: { flex: 1, paddingHorizontal: 26, paddingTop: 18 },
  title: { color: tokens.colors.label, fontSize: 20, fontWeight: '700', lineHeight: 26, marginBottom: 14 },
  quickControls: { alignItems: 'flex-start', flexDirection: 'row', gap: 14, marginBottom: 6 },
  fontSizeStack: { flex: 1 },
  fontSizeControl: { borderRadius: 25, flexDirection: 'row', height: 50, overflow: 'hidden', width: '100%' },
  fontSizeButton: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  fontSizeMinus: { fontSize: 15, fontWeight: '700' },
  fontSizePlus: { fontSize: 20, fontWeight: '700' },
  fontLevelIndicator: { alignItems: 'center', flexDirection: 'row', gap: 5, height: 14, justifyContent: 'center', paddingTop: 6 },
  fontLevelDot: { borderRadius: 2, height: 4, width: 4 },
  controlDivider: { alignSelf: 'center', height: 30, width: StyleSheet.hairlineWidth },
  fontGlyphPressed: { opacity: 0.48, transform: [{ scale: 0.94 }] },
  controlDisabled: { opacity: 0.32 },
  modeGroup: { flexDirection: 'row', gap: 10 },
  modeMenu: { height: 50, width: 50 },
  modeCircle: { borderRadius: 25, height: 50, overflow: 'hidden', width: 50 },
  modeButton: { alignItems: 'center', flex: 1, height: 50, justifyContent: 'center' },
  metricsGroup: { backgroundColor: 'transparent', paddingHorizontal: 4 },
  metricRow: { paddingBottom: 8, paddingTop: 10 },
  metricSeparator: { backgroundColor: 'rgba(60,60,67,0.12)', height: StyleSheet.hairlineWidth },
  settingLabel: { color: tokens.colors.label, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  sliderRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 40 },
  sliderIconContainer: { alignItems: 'center', justifyContent: 'center', width: 26 },
  slider: { flex: 1, height: 38 },
  sliderValue: { color: tokens.colors.secondaryLabel, fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '500', minWidth: 42, textAlign: 'right' },
  resetButton: { alignItems: 'center', borderRadius: 14, justifyContent: 'center', marginTop: 14, minHeight: 44 },
  resetButtonPressed: { backgroundColor: 'rgba(60,60,67,0.08)' },
  resetText: { color: tokens.colors.label, fontSize: 16, fontWeight: '600' },
});
