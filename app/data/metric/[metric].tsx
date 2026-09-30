import { useLocalSearchParams } from 'expo-router';

import { MetricDetailScreen, type DataMetric } from '../../../src/features/data/MetricDetailScreen';

export default function DataMetricRoute() {
  const { metric } = useLocalSearchParams<{ metric?: string | string[] }>();
  const value = Array.isArray(metric) ? metric[0] : metric;
  const safeMetric: DataMetric = value === 'speed' || value === 'rhythm' ? value : 'time';
  return <MetricDetailScreen metric={safeMetric} />;
}
