// SPIKE-ONLY debug screen: native UIPopoverPresentationController + Liquid
// Glass feasibility test. Not part of the real reader footnote flow.
// Remove this file and its tab entry after the spike concludes.

import { useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  dismissSpikePopover,
  isReaderPopoverSpikeAvailable,
  presentSpikePopover,
  type SpikePopoverAnchor,
} from '../../modules/reader-popover-spike';

const SHORT_TEXT = '这是第一条脚注，用于测试原生 Popover 与 Liquid Glass。';

const LONG_TEXT =
  '这是第一条脚注，用于测试原生 Popover 与 Liquid Glass。' +
  '这是一段很长的脚注正文，专门用来验证 Popover 内容超出最大高度时的内部滚动行为。'.repeat(18);

type TestCase = {
  key: string;
  label: string;
  anchor: SpikePopoverAnchor;
  text: string;
  /** Draw the red marker for this anchor on the debug screen. */
  showMarker: boolean;
};

export default function DevPopoverSpikeScreen() {
  const { width: w, height: h } = Dimensions.get('window');

  const cases: TestCase[] = useMemo(
    () => [
      {
        key: 'top',
        label: '测试脚注 · 顶部 anchor',
        anchor: { x: w / 2 - 50, y: 150, width: 100, height: 24 },
        text: SHORT_TEXT,
        showMarker: true,
      },
      {
        key: 'middle',
        label: '测试脚注 · 中部 anchor',
        anchor: { x: w / 2 - 50, y: h / 2 - 12, width: 100, height: 24 },
        text: SHORT_TEXT,
        showMarker: true,
      },
      {
        key: 'bottom',
        label: '测试脚注 · 底部 anchor',
        anchor: { x: w / 2 - 50, y: h - 260, width: 100, height: 24 },
        text: SHORT_TEXT,
        showMarker: true,
      },
      {
        key: 'right',
        label: '测试脚注 · 右边缘 anchor',
        anchor: { x: w - 120, y: h / 2 - 12, width: 90, height: 24 },
        text: SHORT_TEXT,
        showMarker: true,
      },
      {
        key: 'long',
        label: '长文本 · 内部滚动测试（中部）',
        anchor: { x: w / 2 - 50, y: h / 2 - 12, width: 100, height: 24 },
        text: LONG_TEXT,
        showMarker: false,
      },
    ],
    [w, h],
  );

  return (
    <View style={styles.root}>
      {/* Red markers show exactly where each anchor rect is, so the tester can
          verify the system arrow points at the right place. */}
      {cases
        .filter((c) => c.showMarker)
        .map((c) => (
          <View
            key={`marker-${c.key}`}
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: c.anchor.x,
                top: c.anchor.y,
                width: c.anchor.width,
                height: c.anchor.height,
              },
            ]}
          />
        ))}

      <Text style={styles.title}>Native Popover Spike</Text>
      <Text style={styles.subtitle}>
        红色方框 = anchor 位置。点击按钮后观察：箭头是否指向红框、Popover 是否为系统 Liquid
        Glass、方向是否自动调整、外部点击是否关闭。
      </Text>

      {!isReaderPopoverSpikeAvailable && (
        <Text style={styles.warning}>
          原生模块未加载（ReaderPopoverSpike不可用）。需要重新 prebuild / EAS Development Build。
        </Text>
      )}

      {cases.map((c) => (
        <Pressable
          key={c.key}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => presentSpikePopover(c.anchor, c.text)}
        >
          <Text style={styles.buttonText}>{c.label}</Text>
        </Pressable>
      ))}

      <Pressable
        style={({ pressed }) => [styles.button, styles.dismissButton, pressed && styles.buttonPressed]}
        onPress={() => dismissSpikePopover()}
      >
        <Text style={styles.buttonText}>关闭 Popover</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 80,
    paddingHorizontal: 24,
    gap: 12,
  },
  marker: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,59,48,0.9)',
    backgroundColor: 'rgba(255,59,48,0.15)',
    borderRadius: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.7,
    marginBottom: 8,
  },
  warning: {
    fontSize: 14,
    lineHeight: 20,
    color: '#ff3b30',
    marginBottom: 8,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(120,120,128,0.16)',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  dismissButton: {
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
