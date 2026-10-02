import { uiText } from '../../localization';

/**
 * Data Tab Core B：集中 formatter。
 *
 * 所有数字 → 中文展示字符串的转换都在这里，JSX 里只调用，不散落格式化逻辑。
 * Analytics Core 返回类型保持不变（number / null）。
 */

const MINUTE_SECONDS = 60;

/**
 * 阅读时长格式化。
 * - 0 秒 → 0 分钟
 * - >0 且 <60 秒 → < 1 分钟
 * - <60 分钟 → N 分钟
 * - >=60 分钟 → N 小时 M 分钟（总时长可超 24 小时：36 小时，不折成天）
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) return uiText.data.zeroMinutes;
  if (total < MINUTE_SECONDS) return uiText.data.lessThanOneMinute;
  const minutes = Math.floor(total / MINUTE_SECONDS);
  if (minutes < 60) return `${minutes}${uiText.data.minuteUnit}`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (restMinutes === 0) return `${hours}${uiText.data.hourUnit}`;
  return `${hours}${uiText.data.hourUnit} ${restMinutes}${uiText.data.minuteUnit}`;
}

/** 阅读速度：null → —；否则四舍五入为 N 字/分钟。 */
export function formatReadingSpeed(charsPerMinute: number | null): string {
  if (charsPerMinute === null) return '—';
  return `${Math.round(charsPerMinute)} ${uiText.data.speedUnit}`;
}

/**
 * 累计阅读分钟数格式化（底部大卡片第一列）。
 * - <10000 分钟 → N 分钟
 * - >=10000 分钟 → X.X万分钟（去 .0；>=100万分钟时取整）
 */
export function formatTotalMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 10000) return `${total}${uiText.data.minuteUnit}`;
  const wan = total / 10000;
  const text = wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, '');
  return `${text}万${uiText.data.minuteUnit}`;
}

/**
 * dayKey（YYYY-MM-DD）→ 周几单字标签（一…日），用于图表日期刻度。
 * 用本地日历解析，不涉及时区转换；解析失败返回空串。
 */
export function weekdayShortName(dayKey: string): string {
  const parts = dayKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '';
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(date.getTime())) return '';
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()] ?? '';
}

/**
 * dayKey（YYYY-MM-DD）→ 周几中文名（周日…周六）。
 * 用本地日历解析，不涉及时区转换；解析失败返回空串。
 */
export function weekdayName(dayKey: string): string {
  const parts = dayKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '';
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(date.getTime())) return '';
  return uiText.data.weekdayNames[date.getDay()] ?? '';
}
