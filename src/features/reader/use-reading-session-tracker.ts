import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import {
  READING_SESSION_CHECKPOINT_MS,
  ReadingSessionTracker,
} from './reading-session-tracker';
import { readingSessionRepository } from './reading-session-repository';
import type { ReaderTextMeasureResult } from './reader-types';

/**
 * Wires the ReadingSessionTracker into React Native lifecycle:
 * - pushes context (ready / route focus / blocking sheets) on every change
 * - AppState foreground/background drives session close + restart
 * - a 30s interval triggers checkpoints (timing only — seconds are always
 *   computed from timestamp deltas inside the tracker)
 * - disposes (flush + close) when the reader route unmounts
 *
 * The caller keeps calling tracker methods directly (markActivity,
 * handleLocation) — this hook only manages context and lifecycle plumbing.
 */
export type UseReadingSessionTrackerOptions = {
  bookId: string | null;
  readerReady: boolean;
  routeFocused: boolean;
  blocked: boolean;
  requestTextMeasure: (fromCfi: string, toCfi: string) => Promise<ReaderTextMeasureResult>;
};

export function useReadingSessionTracker(
  options: UseReadingSessionTrackerOptions,
): React.MutableRefObject<ReadingSessionTracker> {
  const trackerRef = useRef<ReadingSessionTracker | null>(null);
  const measureRef = useRef(options.requestTextMeasure);
  measureRef.current = options.requestTextMeasure;

  if (!trackerRef.current) {
    trackerRef.current = new ReadingSessionTracker({
      now: () => Date.now(),
      devLog: (tag, data) => {
        if (!__DEV__) return;
        if (data === undefined) console.log(tag);
        else console.log(tag, JSON.stringify(data));
      },
      store: readingSessionRepository,
      // The screen's requestTextMeasure always resolves (bridge timeout ->
      // ok:false), so the tracker's serial queue can never stall here.
      requestTextMeasure: (fromCfi, toCfi) => measureRef.current(fromCfi, toCfi),
    });
  }

  const { bookId, readerReady, routeFocused, blocked } = options;
  const focusedRef = useRef(routeFocused);
  useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    const wasFocused = focusedRef.current;
    focusedRef.current = routeFocused;
    if (wasFocused !== routeFocused) {
      // Route blur/focus needs immediate close/start semantics ('reader-exit'
      // on blur, fresh session on focus) — not just an eligibility flag flip.
      tracker.setContext({ bookId, readerReady, blocked });
      tracker.onRouteFocusChange(routeFocused);
    } else {
      tracker.setContext({ bookId, readerReady, routeFocused, blocked });
    }
  }, [bookId, readerReady, routeFocused, blocked]);

  useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      tracker.onAppStateChange(nextState);
    });
    const intervalId = setInterval(() => {
      tracker.checkpoint();
    }, READING_SESSION_CHECKPOINT_MS);
    return () => {
      subscription.remove();
      clearInterval(intervalId);
      tracker.dispose();
    };
  }, []);

  return trackerRef as React.MutableRefObject<ReadingSessionTracker>;
}
