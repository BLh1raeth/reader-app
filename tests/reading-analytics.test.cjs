const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');

const analytics = createTypeScriptLoader()(
  path.join(__dirname, '..', 'src', 'features', 'data', 'reading-analytics.ts'),
);

test('analytics respects the event-time day stored in SQLite after timezone changes', () => {
  const session = analytics.normalizeAnalyticsSession({
    id: 'session-1', startedAt: '2026-09-26T23:00:00.000Z', endedAt: null,
    activeSeconds: 90, forwardCharacters: 180, localDayKey: '2026-09-27',
  });
  const excerpt = analytics.normalizeAnalyticsExcerpt({
    id: 1, createdAt: '2026-09-26T23:00:00.000Z', createdLocalDayKey: '2026-09-27',
  });
  assert.equal(session.dayKey, '2026-09-27');
  assert.equal(excerpt.dayKey, '2026-09-27');
  const days = analytics.buildDailyStats([session], [excerpt], [], '2026-09-26', '2026-09-28');
  assert.deepEqual(days.map((day) => [day.dayKey, day.activeSeconds, day.excerptCount]), [
    ['2026-09-26', 0, 0],
    ['2026-09-27', 90, 1],
    ['2026-09-28', 0, 0],
  ]);
});
