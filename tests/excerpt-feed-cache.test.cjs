const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');

const cachePath = path.join(__dirname, '..', 'src', 'features', 'excerpts', 'excerpt-feed-cache.ts');

test('prefetch shares its first query and exposes a synchronous first-frame snapshot', async () => {
  let queryCount = 0;
  let resolveFirst;
  const items = [{ id: 'excerpt-1', quoteText: '原文' }];
  const load = createTypeScriptLoader({
    './excerpt-feed-repository': {
      listExcerptFeedItems: () => {
        queryCount += 1;
        return queryCount === 1
          ? new Promise((resolve) => { resolveFirst = resolve; })
          : Promise.resolve(items);
      },
    },
  });
  const cache = load(cachePath);
  let notifications = 0;
  const unsubscribe = cache.subscribeExcerptFeed(() => { notifications += 1; });

  assert.equal(cache.getExcerptFeedSnapshot(), null);
  const prefetch = cache.prefetchExcerptFeed();
  assert.equal(cache.refreshExcerptFeed(), prefetch);
  assert.equal(queryCount, 1);

  resolveFirst(items);
  assert.equal(await prefetch, items);
  assert.equal(cache.getExcerptFeedSnapshot(), items);
  assert.equal(notifications, 1);
  assert.equal(await cache.prefetchExcerptFeed(), items);
  assert.equal(queryCount, 1);

  assert.equal(await cache.refreshExcerptFeed(), items);
  assert.equal(queryCount, 2);
  assert.equal(notifications, 1);
  unsubscribe();
});

test('a failed prefetch leaves the snapshot empty and can be retried', async () => {
  let queryCount = 0;
  const load = createTypeScriptLoader({
    './excerpt-feed-repository': {
      listExcerptFeedItems: () => {
        queryCount += 1;
        return queryCount === 1 ? Promise.reject(new Error('temporary')) : Promise.resolve([]);
      },
    },
  });
  const cache = load(cachePath);

  await assert.rejects(cache.prefetchExcerptFeed(), /temporary/);
  assert.equal(cache.getExcerptFeedSnapshot(), null);
  assert.deepEqual(await cache.prefetchExcerptFeed(), []);
  assert.equal(queryCount, 2);
});
