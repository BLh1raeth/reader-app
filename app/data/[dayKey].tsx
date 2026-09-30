import { useLocalSearchParams } from 'expo-router';

import { DayDetailScreen } from '../../src/features/data/DayDetailScreen';
import { compareLocalDayKeys, isValidDayKey, todayLocalDayKey } from '../../src/shared/time/local-day';

export default function DataDayRoute() {
  const { dayKey } = useLocalSearchParams<{ dayKey?: string | string[] }>();
  const key = Array.isArray(dayKey) ? dayKey[0] : (dayKey ?? '');
  const today = todayLocalDayKey();
  return <DayDetailScreen dayKey={isValidDayKey(key) && compareLocalDayKeys(key, today) <= 0 ? key : today} />;
}
