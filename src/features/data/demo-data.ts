/**
 * Data Tab UI 预览用假数据（DEMO ONLY）。
 *
 * 用途：用户看 UI 效果。只在 DataScreen 里用 USE_DEMO_DATA 开关切换显示，
 * 不写入 SQLite、不经过 service/repository，真实数据链路完全不受影响。
 * 恢复真实数据：把 USE_DEMO_DATA 改成 false（或删掉本文件 + 开关引用）。
 *
 * 数值设计（互相自洽，方便看 UI）：
 * - 今天：1小时25分钟（5100 秒），早 7–10 点、午间、下午、晚间多个时段活跃、
 *   高低起伏大；24 小时桶加起来正好等于今天总量；
 * - 最近 7 天：7 天都有阅读（柱子多），每天速度区间拉开、位置错开
 *   （P10 420–505，P90 505–600，起伏大）；
 * - 节奏：连续阅读 7 天、累计 186 天、摘录 428 条。
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

/** 今天 24 小时分布：11 个小时有阅读、高低起伏大，加总 5100 秒。 */
const DEMO_HOURLY: Array<[hour: number, seconds: number]> = [
  [7, 300],
  [8, 1500],
  [9, 600],
  [10, 250],
  [12, 450],
  [13, 800],
  [15, 200],
  [18, 350],
  [20, 150],
  [21, 300],
  [22, 200],
];

/** 最近 7 天（最旧 → 今天）：阅读秒数 / 字数 / 速度 / 摘录数；区间拉开、位置错开。 */
const DEMO_DAYS: Array<{
  seconds: number;
  chars: number;
  speed: number | null;
  speedP10: number | null;
  speedP90: number | null;
  speedLatest: number | null;
  excerpts: number;
}> = [
  { seconds: 3200, chars: 26800, speed: 502, speedP10: 440, speedP90: 560, speedLatest: 505, excerpts: 2 },
  { seconds: 2100, chars: 16800, speed: 480, speedP10: 420, speedP90: 505, speedLatest: 470, excerpts: 1 },
  { seconds: 5400, chars: 48600, speed: 540, speedP10: 490, speedP90: 600, speedLatest: 560, excerpts: 4 },
  { seconds: 1800, chars: 14400, speed: 480, speedP10: 445, speedP90: 520, speedLatest: 488, excerpts: 1 },
  { seconds: 3900, chars: 33150, speed: 510, speedP10: 460, speedP90: 590, speedLatest: 530, excerpts: 2 },
  { seconds: 4600, chars: 41400, speed: 540, speedP10: 505, speedP90: 585, speedLatest: 545, excerpts: 3 },
  { seconds: 5100, chars: 42500, speed: 500, speedP10: 455, speedP90: 575, speedLatest: 512, excerpts: 5 },
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
    currentStreakDays: 7,
    totalReadingDays: 186,
    last7DaysReadingSpeedCharsPerMinute: 507,
    allTimeReadingSpeedCharsPerMinute: 505,
    todayExcerptCount: 5,
    todayForwardCharacters: 42500,
    totalExcerptCount: 428,
    latestSpeedSample: { dayKey: todayKey, charsPerMinute: 512 },
  };

  return { summary, last7Days, todayKey, hourlyActiveSeconds };
}
