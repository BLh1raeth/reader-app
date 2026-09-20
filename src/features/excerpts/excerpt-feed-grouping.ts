import type { ExcerptFeedItem } from './excerpt-feed-repository';

export type ExcerptFeedSection = {
  key: string;
  title: string;
  data: ExcerptFeedItem[];
};

export type ExcerptFeedGroupLabels = {
  today: string;
  yesterday: string;
  past7Days: string;
  thisMonth: string;
  /** month: 1-12 */
  monthTitle: (year: number, month: number) => string;
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 按设备本地 calendar day 分组。规则互斥：
 * - 今天：本地今天
 * - 昨天：本地昨天
 * - 过去7天：最近 7 个自然日内，但不含今天/昨天（即 2..6 天前）
 * - 本月：同年同月，但不含上面三组
 * - 更早：按年月分组（2026年8月 / 2025年12月 …），倒序
 *
 * 用本地午夜起算的天数差判断，不用 24h 毫秒数硬算昨天，避免
 * 夏令时/时区/午夜边界问题；不硬编码任何时区。
 */
export function groupExcerptFeedItems(
  items: ExcerptFeedItem[],
  labels: ExcerptFeedGroupLabels,
  now: Date = new Date(),
): ExcerptFeedSection[] {
  const todayStart = startOfLocalDay(now).getTime();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();

  const today: ExcerptFeedItem[] = [];
  const yesterday: ExcerptFeedItem[] = [];
  const past7Days: ExcerptFeedItem[] = [];
  const thisMonth: ExcerptFeedItem[] = [];
  const olderByMonth = new Map<string, { year: number; month: number; items: ExcerptFeedItem[] }>();

  for (const item of items) {
    const created = new Date(item.createdAt);
    const dayStart = startOfLocalDay(created).getTime();
    // 两个本地午夜之差；round 抵消 DST 当天 23/25 小时的影响
    const dayDiff = Math.round((todayStart - dayStart) / 86400000);

    if (dayDiff <= 0) {
      today.push(item);
    } else if (dayDiff === 1) {
      yesterday.push(item);
    } else if (dayDiff <= 6) {
      past7Days.push(item);
    } else if (created.getFullYear() === nowYear && created.getMonth() === nowMonth) {
      thisMonth.push(item);
    } else {
      const year = created.getFullYear();
      const month = created.getMonth();
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      let bucket = olderByMonth.get(key);
      if (!bucket) {
        bucket = { year, month, items: [] };
        olderByMonth.set(key, bucket);
      }
      bucket.items.push(item);
    }
  }

  const sections: ExcerptFeedSection[] = [];
  if (today.length > 0) sections.push({ key: 'today', title: labels.today, data: today });
  if (yesterday.length > 0) sections.push({ key: 'yesterday', title: labels.yesterday, data: yesterday });
  if (past7Days.length > 0) sections.push({ key: 'past7Days', title: labels.past7Days, data: past7Days });
  if (thisMonth.length > 0) sections.push({ key: 'thisMonth', title: labels.thisMonth, data: thisMonth });

  const older = [...olderByMonth.values()].sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month,
  );
  for (const bucket of older) {
    sections.push({
      key: `${bucket.year}-${String(bucket.month + 1).padStart(2, '0')}`,
      title: labels.monthTitle(bucket.year, bucket.month + 1),
      data: bucket.items,
    });
  }

  return sections;
}
