import { useLocalSearchParams } from 'expo-router';

import { DayDetailScreen } from '../../src/features/data/DayDetailScreen';

export default function DataDayRoute() {
  const { dayKey } = useLocalSearchParams<{ dayKey?: string | string[] }>();
  const key = Array.isArray(dayKey) ? dayKey[0] : (dayKey ?? '');
  return <DayDetailScreen dayKey={key} />;
}
