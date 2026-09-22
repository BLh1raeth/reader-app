/**
 * Re-export shim. The local-day helpers moved to the shared layer so
 * ReadingSession, Excerpts and Analytics can all use one implementation:
 * src/shared/time/local-day.ts. Import from there in new code.
 */
export * from '../../shared/time/local-day';
