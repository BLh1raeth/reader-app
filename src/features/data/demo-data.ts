/**
 * Data Tab UI 预览用假数据（DEMO ONLY）。
 *
 * 用途：用户看 UI 效果。只在 DataScreen 里用 USE_DEMO_DATA 开关切换显示，
 * 不写入 SQLite、不经过 service/repository，真实数据链路完全不受影响。
 * 恢复真实数据：把 USE_DEMO_DATA 改成 false（或删掉本文件 + 开关引用）。
 *
 * 数值设计（互相自洽，方便看 UI）：
 * - 今天：1小时25分钟（5100 秒），早 8–9 点、午间、晚 21–22 点三个高峰；
 *   24 小时桶加起来正好等于今天总量；
 * - 最近 7 天：5 天有阅读、2 天为 0，速度 480–540 字/分钟；
 * - 节奏：连续阅读 2 天、累计 186 天、摘录 428 条。
 */

import { addLocalCalendarDays } from '../../shared/time/local-day';
import type {
  DailyReadingStats,
  ReadingAnalyticsSummary,
} from './reading-analytics-types';

/** 总开关：DataScreen 引用。改成 false 即恢复真实数据。 */
export const USE_DEMO_DATA = true;

export type DemoDataLoadResult = {
  summary: ReadingAnalyticsSummary;
  last7Days: DailyReadingStats[];
  todayKey: string;
  /** 今天 24 小时 activeSeconds 分桶（0..23），加总 = todayActiveSeconds。 */
  hourlyActiveSeconds: number[];
};

/** 今天 24 小时分布：8–9 点、13 点、21–22 点活跃，加总 5100 秒。 */
const DEMO_HOURLY: Array<[hour: number, seconds: number]> = [
  [8, 1500],
  [9, 900],
  [13, 600],
  [21, 1400],
  [22, 700],
];

/** 最近 7 天（最旧 → 今天）：阅读秒数 / 字数 / 速度 / 摘录数。 */
const DEMO_DAYS: Array<{
  seconds: number;
  chars: number;
  speed: number | null;
  speedP10: number | null;
  speedP90: number | null;
  speedLatest: number | null;
  excerpts: number;
}> = [
  { seconds: 3200, chars: 26800, speed: 502, speedP10: 470, speedP90: 542, speedLatest: 505, excerpts: 2 },
  { seconds: 0, chars: 0, speed: null, speedP10: null, speedP90: null, speedLatest: null, excerpts: 0 },
  { seconds: 5400, chars: 48600, speed: 540, speedP10: 508, speedP90: 575, speedLatest: 560, excerpts: 4 },
  { seconds: 1800, chars: 14400, speed: 480, speedP10: 453, speedP90: 510, speedLatest: 488, excerpts: 1 },
  { seconds: 0, chars: 0, speed: null, speedP10: null, speedP90: null, speedLatest: null, excerpts: 0 },
  { seconds: 4600, chars: 41400, speed: 540, speedP10: 500, speedP90: 568, speedLatest: 545, excerpts: 3 },
  { seconds: 5100, chars: 42500, speed: 500, speedP10: 474, speedP90: 531, speedLatest: 512, excerpts: 5 },
];

export function buildDemoData(todayKey: string): DemoDataLoadResult {
  const hourlyActiveSeconds = new Array<number>(24).fill(0);
  for (const [hour, seconds] of DEMO_HOURLY) {
    hourlyActiveSeconds[hour] = seconds;
  }

  const last7Days: DailyReadingStats[] = DEMO_DAYS.map((day, index) => ({
    dayKey: addLocalCalendarDays(todayKey, index - 6),
    activeSeconds: day.seconds,
    forwardCharacters: day.chars,
    readingSpeedCharsPerMinute: day.speed,
    readingSpeedP10CharsPerMinute: day.speedP10,
    readingSpeedP90CharsPerMinute: day.speedP90,
    readingSpeedLatestCharsPerMinute: day.speedLatest,
    excerptCount: day.excerpts,
  }));

  const last7DaysActiveSeconds = DEMO_DAYS.reduce((sum, day) => sum + day.seconds, 0);

  const summary: ReadingAnalyticsSummary = {
    todayActiveSeconds: 5100,
    last7DaysActiveSeconds,
    previous7CompletedDaysAverageActiveSeconds: 3600,
    totalActiveSeconds: 287400,
    currentStreakDays: 2,
    totalReadingDays: 186,
    last7DaysReadingSpeedCharsPerMinute: 519,
    allTimeReadingSpeedCharsPerMinute: 505,
    todayExcerptCount: 5,
    todayForwardCharacters: 42500,
    totalExcerptCount: 428,
    latestSpeedSample: { dayKey: todayKey, charsPerMinute: 512 },
  };

  return { summary, last7Days, todayKey, hourlyActiveSeconds };
}
