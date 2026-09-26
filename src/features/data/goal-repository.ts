/**
 * Data 目标体系：每日阅读目标的 SQLite 存取。
 *
 * 单行表 reader_daily_goals（id = 1），三个整数：
 * - targetSeconds：每日阅读时长目标（秒）
 * - targetChars：每日阅读字数目标（字）
 * - targetExcerpts：每日摘录目标（条）
 *
 * 默认值：30 分钟 / 10000 字 / 3 条。首次读取无行时自动写入默认值。
 */

import { getLibraryDatabase } from '../library/library-database';

export type DailyGoals = {
  targetSeconds: number;
  targetChars: number;
  targetExcerpts: number;
};

export const DEFAULT_DAILY_GOALS: DailyGoals = {
  targetSeconds: 30 * 60,
  targetChars: 10000,
  targetExcerpts: 3,
};

const GOAL_ROW_ID = 1;

type GoalRow = {
  target_seconds: number;
  target_chars: number;
  target_excerpts: number;
};

export const goalRepository = {
  async getDailyGoals(): Promise<DailyGoals> {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<GoalRow>(
      'SELECT target_seconds, target_chars, target_excerpts FROM reader_daily_goals WHERE id = ?;',
      [GOAL_ROW_ID],
    );
    if (row == null) {
      await this.setDailyGoals(DEFAULT_DAILY_GOALS);
      return { ...DEFAULT_DAILY_GOALS };
    }
    return {
      targetSeconds: row.target_seconds,
      targetChars: row.target_chars,
      targetExcerpts: row.target_excerpts,
    };
  },

  async setDailyGoals(goals: DailyGoals): Promise<void> {
    const database = await getLibraryDatabase();
    const updatedAt = new Date().toISOString();
    await database.runAsync(
      `INSERT INTO reader_daily_goals (id, target_seconds, target_chars, target_excerpts, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         target_seconds = excluded.target_seconds,
         target_chars = excluded.target_chars,
         target_excerpts = excluded.target_excerpts,
         updated_at = excluded.updated_at;`,
      [GOAL_ROW_ID, goals.targetSeconds, goals.targetChars, goals.targetExcerpts, updatedAt],
    );
  },
};
