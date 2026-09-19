import { getLibraryDatabase } from '../library/library-database';
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  type ReaderAppearance,
  type ReaderPageTransition,
  type ReaderSettings,
} from './reader-settings';

type ReaderSettingsRow = {
  font_size: number;
  page_transition: string;
  reader_appearance: string;
  line_height: number;
  letter_spacing: number;
  page_margin: number;
};

export const readerSettingsRepository = {
  async get(): Promise<ReaderSettings> {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<ReaderSettingsRow>(
      'SELECT font_size, page_transition, reader_appearance, line_height, letter_spacing, page_margin FROM reader_settings WHERE id = 1;',
    );
    if (!row) return DEFAULT_READER_SETTINGS;
    return normalizeReaderSettings({
      fontSize: row.font_size,
      pageTransition: row.page_transition as ReaderPageTransition,
      appearance: row.reader_appearance as ReaderAppearance,
      lineHeight: row.line_height,
      letterSpacing: row.letter_spacing,
      pageMargin: row.page_margin,
    });
  },

  async upsert(settings: ReaderSettings) {
    const normalized = normalizeReaderSettings(settings);
    const database = await getLibraryDatabase();
    await database.runAsync(
      `INSERT INTO reader_settings (
        id, font_size, page_transition, reader_appearance, line_height, letter_spacing, page_margin, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        font_size = excluded.font_size,
        page_transition = excluded.page_transition,
        reader_appearance = excluded.reader_appearance,
        line_height = excluded.line_height,
        letter_spacing = excluded.letter_spacing,
        page_margin = excluded.page_margin,
        updated_at = excluded.updated_at;`,
      normalized.fontSize,
      normalized.pageTransition,
      normalized.appearance,
      normalized.lineHeight,
      normalized.letterSpacing,
      normalized.pageMargin,
      new Date().toISOString(),
    );
  },
};
