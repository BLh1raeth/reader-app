const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const payload = (rangeCfi, bookId = 'book-1') => ({
  bookId, rangeCfi, text: '高亮原文', startCfi: 'start', endCfi: 'end',
  chapterTitle: '第一章', sectionIndex: 0, rect: { x: 20, y: 40, width: 100, height: 20 },
});

// Exercise the real hook with a controllable repository. Only React's hook
// storage and native APIs are replaced; callbacks and persistence logic come
// from useReaderSelection, including the closures retained by native events.
function fixture(deleteHighlightByRange = async () => {}) {
  const slots = [], effects = [], errors = [], deletions = [], excerpts = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useEffect(callback, dependencies) {
      const index = cursor++;
      const old = slots[index];
      if (!old || dependencies.some((value, i) => value !== old[i])) effects.push(callback);
      slots[index] = dependencies;
    },
  };
  const load = createTypeScriptLoader({
    react,
    'expo-haptics': { selectionAsync: async () => {}, notificationAsync: async () => {}, NotificationFeedbackType: { Error: 'error' } },
    '../../../shared/operation-errors': { reportOperationError: (...args) => errors.push(args) },
    '../highlight-repository': { highlightRepository: {
      listSnapshotForBook: async () => ['one', 'two'].map((rangeCfi) => ({ rangeCfi, sectionIndex: 0 })),
      deleteHighlightByRange: (...args) => { deletions.push(args); return deleteHighlightByRange(...args); },
    } },
    '../excerpt-repository': { excerptRepository: {
      createExcerpt: async (value) => { excerpts.push(value); return { excerpt: { id: 1 } }; },
      getExcerptById: async () => ({ id: 1, text: '高亮原文', rangeCfi: 'one' }),
    } },
  });
  const { useReaderSelection } = load(path.join(__dirname, '../src/features/reader/hooks/useReaderSelection.ts'));
  const props = { bookId: 'book-1', markReaderActivity() {}, openSearch() {}, requestInitialSearchQuery() {},
    readerViewportWidth: 390, readerViewportHeight: 760, insets: { top: 0, bottom: 0 },
    isReady: false, settingsSheetPresented: false, highlightMenuBlocked: false };
  const render = (updates = {}) => {
    Object.assign(props, updates); cursor = 0;
    const result = useReaderSelection(props);
    for (const effect of effects.splice(0)) effect();
    return result;
  };
  render();
  return { render, errors, deletions, excerpts };
}

const event = (action, id) => ({ nativeEvent: { action, highlightRequestId: id } });

test('highlight deletion ignores stale menus, dismisses without confirmation, and removes paint after persistence', async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  await flush();
  let hook = f.render(); hook.handleHighlightTap(payload('one'));
  hook = f.render(); const first = JSON.parse(hook.nativeHighlightMenuRequest).id;
  hook.handleHighlightTap(payload('two'));
  hook = f.render(); const second = JSON.parse(hook.nativeHighlightMenuRequest).id;
  hook.handleNativeSelectionAction(event('deleteHighlight', first));
  assert.equal(f.deletions.length, 0);
  hook.handleNativeSelectionAction(event('deleteHighlight', second));
  hook.handleNativeSelectionAction(event('deleteHighlight', second));
  hook = f.render();
  assert.equal(hook.nativeHighlightMenuRequest, '');
  assert.deepEqual(f.deletions, [['book-1', 'two']]);
  assert.equal(hook.selectionCommand, null, 'paint remains until the database write succeeds');
  finish(); await flush(); hook = f.render();
  assert.equal(hook.selectionCommand.type, 'remove-highlight');
  assert.equal(hook.selectionCommand.rangeCfi, 'two');
  assert.deepEqual(hook.highlightSnapshot.map((item) => item.rangeCfi), ['one']);
});

test('a failed deletion keeps its highlight and reports the persistence error', async () => {
  const f = fixture(async () => { throw new Error('disk full'); }); await flush();
  let hook = f.render(); hook.handleHighlightTap(payload('one'));
  hook = f.render(); hook.handleNativeSelectionAction(event('deleteHighlight', JSON.parse(hook.nativeHighlightMenuRequest).id));
  await flush(); hook = f.render();
  assert.equal(hook.selectionCommand, null);
  assert.equal(hook.highlightSnapshot.length, 2);
  assert.equal(f.errors.length, 1);
});

test('switching books or opening reader sheets invalidates old native actions', async () => {
  const f = fixture(); await flush();
  let hook = f.render(); hook.handleHighlightTap(payload('one'));
  hook = f.render(); const id = JSON.parse(hook.nativeHighlightMenuRequest).id;
  const oldHandler = hook.handleNativeSelectionAction;
  f.render({ bookId: 'book-2' }); oldHandler(event('deleteHighlight', id));
  assert.equal(f.deletions.length, 0);
  hook = f.render(); hook.handleHighlightTap(payload('one', 'book-2'));
  hook = f.render(); const newId = JSON.parse(hook.nativeHighlightMenuRequest).id;
  f.render({ highlightMenuBlocked: true }); hook.handleNativeSelectionAction(event('deleteHighlight', newId));
  assert.equal(f.deletions.length, 0);
  assert.equal(f.render().nativeHighlightMenuRequest, '');
});

test('the excerpt action uses the tapped highlight even without a DOM selection', async () => {
  const f = fixture(); await flush();
  let hook = f.render(); hook.handleHighlightTap(payload('one'));
  hook = f.render(); hook.handleNativeSelectionAction(event('excerpt', JSON.parse(hook.nativeHighlightMenuRequest).id));
  await flush();
  assert.equal(f.excerpts.length, 1);
  assert.equal(f.excerpts[0].rangeCfi, 'one');
  assert.equal(f.excerpts[0].text, '高亮原文');
});
