import { getLibraryDatabase } from '../library/library-database';
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  type ReaderAppearance,
  type ReaderPageIndicatorMode,
  type ReaderPageTransition,
  type ReaderSettings,
} from './reader-settings';

type ReaderSettingsRow = {
  font_size: number;
  page_transition: string;
  reader_appearance: string;
  appearance_mode: string | null;
  font_family: string | null;
  line_height: number;
  letter_spacing: number;
  page_margin: number;
  color_temp: number | null;
  page_indicator_mode: string | null;
};

const listeners = new Set<(settings: ReaderSettings) => void>();
export function subscribeReaderSettings(listener: (settings: ReaderSettings) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const readerSettingsRepository = {
  async get(): Promise<ReaderSettings> {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<ReaderSettingsRow>(
      'SELECT font_size, page_transition, reader_appearance, appearance_mode, font_family, line_height, letter_spacing, page_margin, color_temp, page_indicator_mode FROM reader_settings WHERE id = 1;',
    );
    if (!row) return DEFAULT_READER_SETTINGS;
    return normalizeReaderSettings({
      fontSize: row.font_size,
      pageTransition: row.page_transition as ReaderPageTransition,
      appearance: (row.appearance_mode ?? row.reader_appearance) as ReaderAppearance,
      fontFamily: row.font_family as ReaderSettings['fontFamily'],
      lineHeight: row.line_height,
      letterSpacing: row.letter_spacing,
      pageMargin: row.page_margin,
      // 旧库在 v20 migration 之前没有这两列（null），归一化回默认值。
      colorTemp: row.color_temp ?? undefined,
      pageIndicatorMode: row.page_indicator_mode as ReaderPageIndicatorMode | undefined,
    });
  },

  async upsert(settings: ReaderSettings) {
    const normalized = normalizeReaderSettings(settings);
    const database = await getLibraryDatabase();
    await database.runAsync(
      `INSERT INTO reader_settings (
        id, font_size, page_transition, reader_appearance, line_height, letter_spacing, page_margin, color_temp, page_indicator_mode, updated_at, appearance_mode, font_family
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        font_size = excluded.font_size,
        page_transition = excluded.page_transition,
        reader_appearance = excluded.reader_appearance,
        line_height = excluded.line_height,
        letter_spacing = excluded.letter_spacing,
        page_margin = excluded.page_margin,
        color_temp = excluded.color_temp,
        page_indicator_mode = excluded.page_indicator_mode,
        appearance_mode = excluded.appearance_mode,
        font_family = excluded.font_family,
        updated_at = excluded.updated_at;`,
      normalized.fontSize,
      normalized.pageTransition,
      normalized.appearance === 'system' ? 'light' : normalized.appearance,
      normalized.lineHeight,
      normalized.letterSpacing,
      normalized.pageMargin,
      normalized.colorTemp,
      normalized.pageIndicatorMode,
      new Date().toISOString(),
      normalized.appearance,
      normalized.fontFamily,
    );
    for (const listener of listeners) {
      try { listener(normalized); }
      catch (error) { if (__DEV__) console.warn('[READER_SETTINGS_LISTENER_FAILED]', error); }
    }
  },
};
