export type ReaderPageTransition = 'dissolve';
export type ReaderAppearance = 'light' | 'dark';

export type ReaderSettings = {
  fontSize: number;
  pageTransition: ReaderPageTransition;
  appearance: ReaderAppearance;
  lineHeight: number;
  /** em units applied to the base reading text. */
  letterSpacing: number;
  /** foliate paginator gap percentage; controls horizontal reading margins. */
  pageMargin: number;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 19,
  pageTransition: 'dissolve',
  appearance: 'light',
  lineHeight: 1.72,
  letterSpacing: 0.01,
  pageMargin: 7,
};

export const READER_SETTINGS_LIMITS = {
  fontSize: { min: 16, max: 24, step: 1 },
  lineHeight: { min: 1.48, max: 2.04 },
  letterSpacing: { min: -0.02, max: 0.08 },
  pageMargin: { min: 4, max: 12 },
} as const;

function clampStep(value: number, min: number, max: number, step: number) {
  const clamped = Math.max(min, Math.min(max, value));
  const stepped = min + Math.round((clamped - min) / step) * step;
  return Number(stepped.toFixed(2));
}

function clampPrecision(value: number, min: number, max: number, precision: number) {
  return Number(Math.max(min, Math.min(max, value)).toFixed(precision));
}

export function normalizeReaderSettings(value: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  const fontSize = typeof value?.fontSize === 'number' && Number.isFinite(value.fontSize)
    ? value.fontSize
    : DEFAULT_READER_SETTINGS.fontSize;
  const lineHeight = typeof value?.lineHeight === 'number' && Number.isFinite(value.lineHeight)
    ? value.lineHeight
    : DEFAULT_READER_SETTINGS.lineHeight;
  const letterSpacing = typeof value?.letterSpacing === 'number' && Number.isFinite(value.letterSpacing)
    ? value.letterSpacing
    : DEFAULT_READER_SETTINGS.letterSpacing;
  const pageMargin = typeof value?.pageMargin === 'number' && Number.isFinite(value.pageMargin)
    ? value.pageMargin
    : DEFAULT_READER_SETTINGS.pageMargin;
  return {
    fontSize: clampStep(fontSize, READER_SETTINGS_LIMITS.fontSize.min, READER_SETTINGS_LIMITS.fontSize.max, READER_SETTINGS_LIMITS.fontSize.step),
    // Cross-dissolve is the only supported page-turn treatment for now.
    // Legacy persisted values are deliberately normalized back to it.
    pageTransition: 'dissolve',
    appearance: value?.appearance === 'dark' ? 'dark' : 'light',
    lineHeight: clampPrecision(lineHeight, READER_SETTINGS_LIMITS.lineHeight.min, READER_SETTINGS_LIMITS.lineHeight.max, 3),
    letterSpacing: clampPrecision(letterSpacing, READER_SETTINGS_LIMITS.letterSpacing.min, READER_SETTINGS_LIMITS.letterSpacing.max, 3),
    pageMargin: clampPrecision(pageMargin, READER_SETTINGS_LIMITS.pageMargin.min, READER_SETTINGS_LIMITS.pageMargin.max, 2),
  };
}

export function readerLayoutSettingsEqual(left: ReaderSettings, right: ReaderSettings) {
  return left.fontSize === right.fontSize
    && left.lineHeight === right.lineHeight
    && left.letterSpacing === right.letterSpacing
    && left.pageMargin === right.pageMargin;
}

export function readerSettingsEqual(left: ReaderSettings, right: ReaderSettings) {
  return readerLayoutSettingsEqual(left, right)
    && left.pageTransition === right.pageTransition
    && left.appearance === right.appearance;
}
