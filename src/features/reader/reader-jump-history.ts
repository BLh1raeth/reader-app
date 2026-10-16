import type { ReaderLocation, ReaderRestoreState } from './reader-types';

/** A small per-book back stack, independent of pagination and bookmarks. */
export class ReaderJumpHistory {
  private previous: string | null = null;
  private targets: string[] = [];
  get canReturn() { return this.targets.length > 0; }

  observe(location: ReaderLocation, state: ReaderRestoreState) {
    if (state !== 'active' || !location.cfi) return;
    if (this.previous && this.previous !== location.cfi
      && ['toc', 'search', 'bookmark', 'annotation'].includes(location.navigationReason ?? '')) {
      if (this.targets.at(-1) !== this.previous) this.targets.push(this.previous);
      if (this.targets.length > 20) this.targets.shift();
    }
    this.previous = location.cfi;
  }
  peek(): string | null { return this.targets.at(-1) ?? null; }
  confirmReturn(target: string) {
    if (this.targets.at(-1) === target) this.targets.pop();
  }
  reset() { this.previous = null; this.targets = []; }
}
