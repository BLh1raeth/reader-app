/**
 * 每日目标设置 Sheet（Data 目标体系）。
 *
 * 液态玻璃：@expo/ui/swift-ui BottomSheet + expo-glass-effect GlassView，
 * 与 ReaderSettingsSheet 同一模式；iOS 26 以下用半透明 View 兜底。
 *
 * 三行目标：阅读时长（分钟）/ 阅读字数（字）/ 摘录（条）。
 * 每行 stepper（− / +）即时生效（onChange 直接持久化）；时长行另有
 * 15 / 30 / 60 分钟快捷预设。入口：今日阅读卡三圆环点击。
 */

import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiText } from '../../../localization';
import { useDataTheme } from '../dataTheme';
import type { DailyGoals } from '../goal-repository';

/** 时长步进 5 分钟；字数步进 1000；摘录步进 1。 */
const DURATION_STEP_MIN = 5;
const CHARS_STEP = 1000;
const EXCERPT_STEP = 1;

const DURATION_MIN_MIN = 5;
const DURATION_MAX_MIN = 480;
const CHARS_MIN = 1000;
const CHARS_MAX = 100000;
const EXCERPT_MIN = 1;
const EXCERPT_MAX = 50;

const DURATION_PRESETS_MIN = [15, 30, 60];

type Props = {
  isPresented: boolean;
  goals: DailyGoals;
  onChange: (goals: DailyGoals) => void;
  onDismissed: () => void;
  onRequestDismiss: () => void;
};

function StepperRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  primaryColor,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  primaryColor: string;
}) {
  const canDecrease = value > min;
  const canIncrease = value < max;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: primaryColor }]}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityLabel={`${label}减少`}
          accessibilityRole="button"
          disabled={!canDecrease}
          onPress={() => onChange(Math.max(min, value - step))}
          style={[styles.stepButton, !canDecrease && styles.stepDisabled]}
        >
          <SymbolView
            name="minus"
            size={16}
            tintColor={primaryColor}
            weight="medium"
          />
        </Pressable>
        <Text style={[styles.stepValue, { color: primaryColor }]}>
          {value.toLocaleString()}
        </Text>
        <Pressable
          accessibilityLabel={`${label}增加`}
          accessibilityRole="button"
          disabled={!canIncrease}
          onPress={() => onChange(Math.min(max, value + step))}
          style={[styles.stepButton, !canIncrease && styles.stepDisabled]}
        >
          <SymbolView
            name="plus"
            size={16}
            tintColor={primaryColor}
            weight="medium"
          />
        </Pressable>
      </View>
    </View>
  );
}

export function GoalSettingSheet({
  isPresented,
  goals,
  onChange,
  onDismissed,
  onRequestDismiss,
}: Props) {
  const insets = useSafeAreaInsets();
  const theme = useDataTheme();
  const primaryColor = theme.primaryText;
  const secondaryColor = theme.secondaryText;

  const durationMin = Math.round(goals.targetSeconds / 60);

  return (
    <Host pointerEvents="none" style={styles.sheetHost}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismissed}
        onIsPresentedChange={(presented) => {
          if (!presented) onRequestDismiss();
        }}
      >
        <Group
          modifiers={[
            frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
            // 内容只有标题 + 三行 + 一行预设，用 0.42 屏高贴合内容，
            // 不用 medium（半屏）避免下面大片空白。
            presentationDetents([{ fraction: 0.42 }]),
            presentationDragIndicator('hidden'),
            presentationBackground('transparent'),
          ]}
        >
          <RNHostView>
            <View style={styles.sheetContent}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView
                  glassEffectStyle="clear"
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { bottom: -insets.bottom }]}
                />
              ) : (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: 'rgba(246,246,250,0.82)',
                      bottom: -insets.bottom,
                    },
                  ]}
                />
              )}

              <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <Text style={[styles.title, { color: primaryColor }]}>
                  {uiText.data.goalSheetTitle}
                </Text>

                <StepperRow
                  label={uiText.data.goalDurationLabel}
                  value={durationMin}
                  min={DURATION_MIN_MIN}
                  max={DURATION_MAX_MIN}
                  step={DURATION_STEP_MIN}
                  onChange={(min) =>
                    onChange({ ...goals, targetSeconds: min * 60 })
                  }
                  primaryColor={primaryColor}
                />

                <View style={styles.presetsRow}>
                  {DURATION_PRESETS_MIN.map((preset) => {
                    const selected = durationMin === preset;
                    return (
                      <Pressable
                        key={preset}
                        accessibilityRole="button"
                        onPress={() =>
                          onChange({ ...goals, targetSeconds: preset * 60 })
                        }
                        style={[
                          styles.preset,
                          selected && styles.presetSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.presetText,
                            { color: selected ? primaryColor : secondaryColor },
                          ]}
                        >
                          {preset}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <StepperRow
                  label={uiText.data.goalCharsLabel}
                  value={goals.targetChars}
                  min={CHARS_MIN}
                  max={CHARS_MAX}
                  step={CHARS_STEP}
                  onChange={(chars) => onChange({ ...goals, targetChars: chars })}
                  primaryColor={primaryColor}
                />

                <StepperRow
                  label={uiText.data.goalExcerptsLabel}
                  value={goals.targetExcerpts}
                  min={EXCERPT_MIN}
                  max={EXCERPT_MAX}
                  step={EXCERPT_STEP}
                  onChange={(count) =>
                    onChange({ ...goals, targetExcerpts: count })
                  }
                  primaryColor={primaryColor}
                />
              </View>
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  sheetHost: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  sheetContent: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 4,
  },
  title: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  rowLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,120,128,0.12)',
  },
  stepDisabled: {
    opacity: 0.3,
  },
  stepValue: {
    fontSize: 17,
    fontWeight: '700',
    // 固定宽度：数字从 "6" 变到 "100,000" 时 + 按钮不左右抖；
    // lineHeight 与按钮同高 32，让数字视觉中心与 −/+ 圆钮对齐。
    width: 88,
    lineHeight: 32,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    marginTop: -4,
  },
  preset: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(120,120,128,0.12)',
  },
  presetSelected: {
    backgroundColor: 'rgba(120,120,128,0.32)',
  },
  presetText: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
