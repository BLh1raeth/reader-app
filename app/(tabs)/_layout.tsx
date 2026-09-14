import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Icon sf="books.vertical" />
        <NativeTabs.Trigger.Label>书库</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="data">
        <NativeTabs.Trigger.Icon sf="chart.bar.xaxis" />
        <NativeTabs.Trigger.Label>数据</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="excerpts">
        <NativeTabs.Trigger.Icon sf="quote.bubble" />
        <NativeTabs.Trigger.Label>摘录</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
