import type {
  ReaderLocation,
  ReaderLocationChangeReason,
  ReaderRestoreState,
  ReaderTextMeasureResult,
} from './reader-types';
import type {
  NewReadingSession,
  ReadingSessionClose,
  ReadingSessionCloseReason,
  ReadingSessionStore,
  ReadingSessionUpdate,
} from './reading-session-repository';

/**
 * ReadingSession Core A: reading behavior data layer.
 *
 * First principle: NEVER treat "Reader open time" as reading time. Only
 * timestamp deltas accumulated while the reader is genuinely eligible count
 * toward activeSeconds. Timers only decide *when* to checkpoint, never
 * *how much* time passed.
 *
 * This class is pure TypeScript (no React Native imports) so the accounting
 * algorithm can be unit-tested in Node. React lifecycle (AppState, route
 * focus, checkpoint interval) is wired by useReadingSessionTracker.
 */

export const READING_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const READING_SESSION_CHECKPOINT_MS = 30 * 1000;
export const READING_SESSION_MEASURE_TIMEOUT_MS = 10 * 1000;

export type ReadingSessionContext = {
  bookId: string | null;
  readerReady: boolean;
  routeFocused: boolean;
  appActive: boolean;
  /** A management sheet (TOC/search/settings) covers the reader: time pauses, session stays open. */
  blocked: boolean;
};

export type ReadingSessionTrackerDeps = {
  now: () => number;
  devLog: (tag: string, data?: unknown) => void;
  store: ReadingSessionStore;
  /**
   * Bridge to the engine's measureForwardText. Resolves even on failure
   * ({ ok: false }) — a failed measurement contributes 0 characters and
   * never blocks the queue.
   */
  requestTextMeasure: (fromCfi: string, toCfi: string) => Promise<ReaderTextMeasureResult>;
};

type ActiveReadingSession = {
  id: string;
  bookId: string;
  startedAtMs: number;
  activeMs: number;
  startCfi: string | null;
  startSectionIndex: number | null;
  forwardCharacters: number;
  lastInteractionAtMs: number;
  lastCheckpointAtMs: number;
  lastAccountingAtMs: number;
  /** Highest CFI confirmed read in the current continuous segment. Never moves backward. */
  highWaterCfi: string | null;
  /** Bumped on every segment rebase; drops stale queued measurements. */
  measureGeneration: number;
};

function nextLocalMidnightMs(afterMs: number): number {
  const date = new Date(afterMs);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export class ReadingSessionTracker {
  private ctx: ReadingSessionContext = {
    bookId: null,
    readerReady: false,
    routeFocused: false,
    appActive: true,
    blocked: false,
  };

  private active: ActiveReadingSession | null = null;
  private measureQueue: Promise<void> = Promise.resolve();

  /** Last raw location, whatever its restore state (used for endCfi). */
  private lastLocationCfi: string | null = null;
  private lastLocationSpineIndex: number | null = null;
  /** Last location with restoreState === 'active' (session start baseline). */
  private lastStableCfi: string | null = null;
  private lastStableSpineIndex: number | null = null;

  constructor(private readonly deps: ReadingSessionTrackerDeps) {}

  // ---------------------------------------------------------------- context

  setContext(patch: Partial<ReadingSessionContext>): void {
    const nowMs = this.deps.now();
    // Flush eligible time up to now UNDER THE PREVIOUS context, then switch.
    // This is what keeps a sheet-open minute (R/S) or a background switch
    // from leaking into activeSeconds.
    this.account(nowMs);
    const previousBookId = this.ctx.bookId;
    Object.assign(this.ctx, patch);
    if (this.ctx.bookId !== previousBookId) {
      this.closeSession('book-change', nowMs);
    }
    // Becoming (in)eligible mid-session needs no extra work: account() above
    // already advanced lastAccountingAtMs to now, so no gap is backfilled.
    this.maybeStartSession(nowMs);
  }

  onAppStateChange(nextState: string): void {
    const nowMs = this.deps.now();
    if (nextState === 'active') {
      this.ctx.appActive = true;
      // Never resume the old session: a fresh one starts if still eligible.
      this.maybeStartSession(nowMs);
      return;
    }
    this.account(nowMs);
    this.flushCheckpoint(nowMs);
    this.closeSession('app-background', nowMs);
    this.ctx.appActive = false;
  }

  onRouteFocusChange(focused: boolean): void {
    const nowMs = this.deps.now();
    if (!focused) {
      this.account(nowMs);
      this.flushCheckpoint(nowMs);
      this.closeSession('reader-exit', nowMs);
    }
    this.ctx.routeFocused = focused;
    if (focused) this.maybeStartSession(nowMs);
  }

  /** Checkpoint tick (timer only decides *when*; deltas decide *how much*). */
  checkpoint(): void {
    const nowMs = this.deps.now();
    this.account(nowMs);
    this.flushCheckpoint(nowMs);
  }

  dispose(): void {
    const nowMs = this.deps.now();
    this.account(nowMs);
    this.flushCheckpoint(nowMs);
    this.closeSession('reader-exit', nowMs);
    this.active = null;
  }

  // ---------------------------------------------------------------- activity

  /**
   * Single entry point for "the user did something in the Reader".
   * Page turns arrive via handleLocation (reason reading-forward/backward);
   * chrome taps, sheets, selection, annotations and footnotes call this
   * explicitly from the screen layer.
   *
   * activity != forwardCharacters: flipping backward counts as active time
   * but contributes 0 characters.
   */
  markActivity(nowMs: number = this.deps.now()): void {
    const session = this.active;
    if (session) {
      session.lastInteractionAtMs = nowMs;
      return;
    }
    // Touching the reader after an idle-close legitimately starts a new
    // session from the last known position.
    this.maybeStartSession(nowMs);
  }

  // ---------------------------------------------------------------- location

  handleLocation(location: ReaderLocation, restoreState: ReaderRestoreState): void {
    const nowMs = this.deps.now();
    if (location.cfi) {
      this.lastLocationCfi = location.cfi;
      this.lastLocationSpineIndex = typeof location.spineIndex === 'number' ? location.spineIndex : null;
    }
    const reason: ReaderLocationChangeReason = location.navigationReason ?? 'unknown';
    if (restoreState === 'active' && location.cfi) {
      this.lastStableCfi = location.cfi;
      this.lastStableSpineIndex = typeof location.spineIndex === 'number' ? location.spineIndex : null;
      // The first stable location can arrive after the ready flag.
      this.maybeStartSession(nowMs);
    }
    const session = this.active;
    if (!session) return;

    if (reason === 'reading-forward' || reason === 'reading-backward') {
      // A real page turn is a real touch, even if the screen layer never saw
      // the gesture (gesture classification lives in the DOM adapter).
      session.lastInteractionAtMs = nowMs;
    }
    if (restoreState !== 'active' || !location.cfi) {
      // Unstable position (restore / repagination in flight): rebase the
      // segment silently, never measure.
      this.rebaseSegment(session, location.cfi);
      return;
    }
    if (reason === 'reading-forward') {
      this.handleReadingForward(session, location.cfi);
    } else if (reason !== 'reading-backward') {
      // toc / search / bookmark / annotation / restore /
      // settings-repagination / programmatic / unknown: rebase, no chars.
      // 'unknown' is deliberately conservative — never treat an
      // unclassified relocation as reading.
      this.rebaseSegment(session, location.cfi);
      this.deps.devLog('[READING_NAVIGATION_REBASE]', {
        reason,
        sectionIndex: location.spineIndex,
      });
    }
    // reading-backward: active time accrues via the interaction above;
    // forwardCharacters += 0 and the high-water mark does not move.
  }

  // ---------------------------------------------------------------- internals

  private computeEligible(ctx: ReadingSessionContext = this.ctx): boolean {
    return (
      ctx.bookId !== null &&
      ctx.readerReady &&
      ctx.routeFocused &&
      ctx.appActive &&
      !ctx.blocked
    );
  }

  private maybeStartSession(nowMs: number): void {
    if (this.active) return;
    const { bookId, readerReady, routeFocused, appActive } = this.ctx;
    if (!bookId || !readerReady || !routeFocused || !appActive) return;
    if (!this.lastStableCfi) return;
    const session: ActiveReadingSession = {
      id: `rsess-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      bookId,
      startedAtMs: nowMs,
      activeMs: 0,
      startCfi: this.lastStableCfi,
      startSectionIndex: this.lastStableSpineIndex,
      forwardCharacters: 0,
      lastInteractionAtMs: nowMs,
      lastCheckpointAtMs: nowMs,
      lastAccountingAtMs: nowMs,
      highWaterCfi: this.lastStableCfi,
      measureGeneration: 0,
    };
    this.active = session;
    this.measureQueue = Promise.resolve();
    this.deps.devLog('[READING_SESSION_START]', {
      bookId,
      sessionId: session.id,
      startSectionIndex: session.startSectionIndex,
    });
    const payload: NewReadingSession = {
      id: session.id,
      bookId: session.bookId,
      startedAt: toIso(session.startedAtMs),
      endedAt: null,
      activeSeconds: 0,
      startCfi: session.startCfi,
      endCfi: null,
      startSectionIndex: session.startSectionIndex,
      endSectionIndex: null,
      forwardCharacters: 0,
      lastInteractionAt: toIso(session.lastInteractionAtMs),
      lastCheckpointAt: toIso(session.lastCheckpointAtMs),
      closeReason: null,
    };
    void this.deps.store.createReadingSession(payload).catch((error: unknown) => {
      this.deps.devLog('[READING_SESSION_STORE_FAILED]', { op: 'create', message: String(error) });
    });
  }

  /**
   * Timestamp-delta accounting. Adds at most
   * min(now, lastInteractionAt + IDLE_TIMEOUT) - lastAccountingAt, split at
   * local midnights. Never derives seconds from timer tick counts.
   */
  private account(nowMs: number): void {
    const session = this.active;
    if (!session) return;
    if (!this.computeEligible()) {
      session.lastAccountingAtMs = nowMs;
      return;
    }
    const idleDeadlineMs = session.lastInteractionAtMs + READING_SESSION_IDLE_TIMEOUT_MS;
    const effectiveEndMs = Math.min(nowMs, idleDeadlineMs);
    let cursorMs = session.lastAccountingAtMs;
    if (effectiveEndMs > cursorMs) {
      // A session never crosses a local day: split at each midnight so the
      // future Data Tab can aggregate per-day reading exactly.
      for (;;) {
        const current = this.active;
        if (!current) return;
        const midnightMs = nextLocalMidnightMs(cursorMs);
        if (midnightMs > effectiveEndMs) break;
        current.activeMs += midnightMs - cursorMs;
        this.flushCheckpoint(midnightMs);
        this.closeSession('day-rollover', midnightMs);
        // Continue the remainder in a fresh session starting at midnight,
        // from the same reading location. No time lost, none double-counted.
        this.maybeStartSession(midnightMs);
        if (!this.active) return;
        cursorMs = midnightMs;
      }
      const current = this.active;
      if (!current) return;
      current.activeMs += effectiveEndMs - cursorMs;
      current.lastAccountingAtMs = effectiveEndMs;
    }
    const current = this.active;
    if (current && nowMs > current.lastInteractionAtMs + READING_SESSION_IDLE_TIMEOUT_MS) {
      this.deps.devLog('[READING_SESSION_IDLE]', {
        lastInteractionAt: toIso(current.lastInteractionAtMs),
        idleDeadline: toIso(current.lastInteractionAtMs + READING_SESSION_IDLE_TIMEOUT_MS),
      });
      // endedAt is the idle deadline, not the (later) detection moment.
      this.flushCheckpoint(current.lastInteractionAtMs + READING_SESSION_IDLE_TIMEOUT_MS);
      this.closeSession('idle', current.lastInteractionAtMs + READING_SESSION_IDLE_TIMEOUT_MS);
    }
  }

  private flushCheckpoint(nowMs: number): void {
    const session = this.active;
    if (!session) return;
    session.lastCheckpointAtMs = nowMs;
    this.deps.devLog('[READING_SESSION_CHECKPOINT]', {
      sessionId: session.id,
      activeSeconds: Math.round((session.activeMs / 1000) * 10) / 10,
      forwardCharacters: session.forwardCharacters,
    });
    const patch: ReadingSessionUpdate = {
      activeSeconds: session.activeMs / 1000,
      endCfi: this.lastLocationCfi,
      endSectionIndex: this.lastLocationSpineIndex,
      forwardCharacters: session.forwardCharacters,
      lastInteractionAt: toIso(session.lastInteractionAtMs),
      lastCheckpointAt: toIso(session.lastCheckpointAtMs),
    };
    void this.deps.store.updateReadingSession(session.id, patch).catch((error: unknown) => {
      this.deps.devLog('[READING_SESSION_STORE_FAILED]', { op: 'update', message: String(error) });
    });
  }

  private closeSession(reason: ReadingSessionCloseReason, endedAtMs: number): void {
    const session = this.active;
    if (!session) return;
    this.active = null;
    // Invalidate any queued measurements from the old segment.
    session.measureGeneration += 1;
    this.deps.devLog('[READING_SESSION_CLOSE]', {
      sessionId: session.id,
      activeSeconds: Math.round((session.activeMs / 1000) * 10) / 10,
      forwardCharacters: session.forwardCharacters,
      closeReason: reason,
    });
    const close: ReadingSessionClose = {
      endedAt: toIso(endedAtMs),
      endCfi: this.lastLocationCfi,
      endSectionIndex: this.lastLocationSpineIndex,
      activeSeconds: session.activeMs / 1000,
      forwardCharacters: session.forwardCharacters,
      closeReason: reason,
    };
    void this.deps.store.closeReadingSession(session.id, close).catch((error: unknown) => {
      this.deps.devLog('[READING_SESSION_STORE_FAILED]', { op: 'close', message: String(error) });
    });
  }

  private rebaseSegment(session: ActiveReadingSession, cfi: string | null): void {
    // A relocate that reports the current high-water CFI carries no new
    // information; ignoring it keeps a queued forward measurement alive
    // across foliate's settle duplicates.
    if (!cfi || cfi === session.highWaterCfi) return;
    session.highWaterCfi = cfi;
    session.measureGeneration += 1;
  }

  /**
   * Normal forward reading movement. Only text newly advanced past the
   * segment high-water mark counts; re-reading already-passed text adds 0.
   * Measurement is async and strictly ordered via the serial queue so
   * A→B→C can never settle out of order.
   */
  private handleReadingForward(session: ActiveReadingSession, cfi: string): void {
    if (session.highWaterCfi === cfi) return;
    const fromCfi = session.highWaterCfi ?? session.startCfi ?? cfi;
    // Advance the mark synchronously; the async measurement only settles the
    // character count. A failed measurement adds 0 but keeps the mark —
    // never re-count the same span twice.
    session.highWaterCfi = cfi;
    const generation = session.measureGeneration;
    this.measureQueue = this.measureQueue.then(async () => {
      if (this.active !== session || generation !== session.measureGeneration) return;
      let result: ReaderTextMeasureResult;
      try {
        result = await this.deps.requestTextMeasure(fromCfi, cfi);
      } catch (error) {
        result = { id: '', ok: false, error: String(error) };
      }
      if (this.active !== session || generation !== session.measureGeneration) return;
      if (result.ok && result.direction === 'forward' && result.characters > 0) {
        session.forwardCharacters += result.characters;
        this.deps.devLog('[READING_FORWARD]', {
          fromSection: result.fromSectionIndex,
          toSection: result.toSectionIndex,
          charactersAdded: result.characters,
          totalForwardCharacters: session.forwardCharacters,
        });
      } else if (!result.ok) {
        // Never print book text: only the failure reason.
        this.deps.devLog('[READING_TEXT_MEASURE_FAILED]', {
          bookId: session.bookId,
          reason: result.error,
        });
      }
      // direction 'same'/'backward' (already at/past high-water): +0.
    });
  }
}
