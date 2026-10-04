const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { ReadingSessionTracker } = createTypeScriptLoader()(
  path.join(__dirname, '..', 'src/features/reader/reading-session-tracker.ts'),
);
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(setImmediate); };

function fixture(measure) {
  let now = new Date(2026, 9, 1, 12).getTime();
  const writes = [];
  const samples = [];
  const tracker = new ReadingSessionTracker({
    now: () => now, devLog: () => {},
    requestTextMeasure: measure ?? (async (from, to) => ({
      id: '', ok: true, direction: +to > +from ? 'forward' : +to < +from ? 'backward' : 'same',
      characters: Math.max(0, +to - +from), fromSectionIndex: 0, toSectionIndex: 0,
    })),
    store: {
      async createReadingSession(value) { writes.push({ type: 'create', ...value }); return value; },
      async updateReadingSession(id, value) { writes.push({ type: 'update', id, ...value }); },
      async closeReadingSession(id, value) { writes.push({ type: 'close', id, ...value }); },
      async createSpeedSample(value) { samples.push(value); },
    },
  });
  const locate = (cfi, reason = 'reading-forward') => tracker.handleLocation({
    cfi: String(cfi), spineIndex: 0, tocItemId: null, percentage: 0,
    currentPage: null, totalPages: null, navigationReason: reason,
  }, 'active');
  tracker.setContext({ bookId: 'book', readerReady: true, routeFocused: true });
  locate(0, 'restore');
  return { tracker, locate, writes, samples, advance: (ms) => { now += ms; } };
}

test('backtracking and re-reading never lower the confirmed high-water mark', async () => {
  const { tracker, locate, writes } = fixture();
  locate(300); await settle();
  locate(0, 'reading-backward'); locate(100); locate(300);
  await settle(); tracker.dispose(); await settle();
  assert.equal(writes.findLast((write) => write.type === 'close').forwardCharacters, 300);
});

test('rapid turns and duplicate settle relocations count each span once', async () => {
  const { tracker, locate, writes } = fixture();
  locate(100); locate(200); locate(300); locate(300, 'unknown');
  tracker.dispose(); await settle();
  assert.equal(writes.findLast((write) => write.type === 'close').forwardCharacters, 300);
  assert.equal(writes[0].type, 'create');
  assert.equal(writes.at(-1).type, 'close');
});

test('navigation jumps establish a new segment without counting skipped text', async () => {
  const { tracker, locate, writes } = fixture();
  locate(100); await settle(); locate(1000, 'toc'); locate(1100);
  await settle(); tracker.dispose(); await settle();
  assert.equal(writes.findLast((write) => write.type === 'close').forwardCharacters, 200);
});

test('a delayed timer normalizes speed to actual eligible seconds', async () => {
  const { tracker, locate, samples, advance } = fixture();
  advance(120000); locate(300); await settle(); tracker.checkpoint(); await settle();
  assert.equal(samples[0].chars, 150);
  tracker.dispose(); await settle();
});

test('blocking sheets do not accrue active reading time', async () => {
  const { tracker, locate, writes, advance } = fixture();
  advance(30000); tracker.setContext({ blocked: true });
  advance(120000); tracker.setContext({ blocked: false });
  advance(30000); locate(300); await settle(); tracker.dispose(); await settle();
  assert.equal(writes.findLast((write) => write.type === 'close').activeSeconds, 60);
});

test('changing books waits for the new book location instead of reusing the old CFI', async () => {
  const { tracker, locate, writes } = fixture();
  tracker.setContext({ bookId: 'second' }); await settle();
  assert.equal(writes.filter((write) => write.type === 'create').length, 1);
  locate(20, 'restore'); await settle();
  assert.equal(writes.filter((write) => write.type === 'create').at(-1).startCfi, '20');
  tracker.dispose(); await settle();
});

test('activity after a delayed idle timer does not backfill unattended minutes', async () => {
  const { tracker, writes, advance } = fixture();
  advance(20 * 60000); tracker.markActivity(); await settle();
  assert.equal(writes.find((write) => write.type === 'close').activeSeconds, 600);
  assert.equal(writes.filter((write) => write.type === 'create').length, 2);
  advance(30000); tracker.dispose(); await settle();
  assert.equal(writes.findLast((write) => write.type === 'close').activeSeconds, 30);
});
