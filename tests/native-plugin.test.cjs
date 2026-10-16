const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function fixture(t, pluginSource = fs.readFileSync(path.join(__dirname, '../plugins/with-reader-edit-menu.js'), 'utf8')) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-plugin-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const packageRoot = path.join(projectRoot, 'node_modules/@expo/dom-webview');
  const ios = path.join(packageRoot, 'ios'); fs.mkdirSync(ios, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '57.0.1' }));
  const installed = path.dirname(require.resolve('@expo/dom-webview/package.json'));
  const names = ['DomWebView.swift', 'DomWebViewModule.swift', 'ExpoDomWebView.podspec'];
  for (const name of names) fs.copyFileSync(path.join(installed, 'ios', name), path.join(ios, name));
  const module = { exports: {} };
  const requireMock = (id) => id === 'expo/config-plugins' ? { withDangerousMod: (_, [, callback]) => callback } : require(id);
  requireMock.resolve = require.resolve;
  new Function('require', 'module', 'exports', pluginSource)(requireMock, module, module.exports);
  const apply = () => module.exports({})({ modRequest: { projectRoot } });
  const read = () => names.map((name) => fs.readFileSync(path.join(ios, name), 'utf8'));
  return { apply, read, ios, packageRoot };
}

test('native edit-menu patch applies to pinned Expo files and is idempotent', async (t) => {
  const { apply, read } = fixture(t);
  await apply(); const first = read(); await apply();
  assert.deepEqual(read(), first);
  assert.ok(first[0].includes('readerEditMenuCoordinator?.buildMenu(with: builder)'));
  assert.ok(first[1].includes('Prop("readerEditMenuEnabled")'));
  assert.ok(first[2].includes("s.dependency 'ReaderEditMenu'"));
  assert.ok(first[0].includes('ReaderHighlightMenuPresenter('));
  assert.ok(first[0].includes('"highlightRequestId": requestID'));
  assert.ok(first[1].includes('Prop("readerHighlightMenuRequest")'));
});

test('an existing selection-only patch upgrades without reinstalling and stays idempotent', async (t) => {
  const current = fs.readFileSync(path.join(__dirname, '../plugins/with-reader-edit-menu.js'), 'utf8');
  // The previous integration has the same pinned patch targets, without the
  // second-stage presenter/prop extensions. Exercise the real upgrade path.
  const previous = current.replaceAll('return patchHighlightIntegration(source, filePath);', 'return source;')
    .replaceAll('return patchHighlightProp(source, filePath);', 'return source;');
  const old = fixture(t, previous);
  await old.apply();
  assert.ok(!old.read()[0].includes('ReaderHighlightMenuPresenter('));
  const module = { exports: {} };
  const requireMock = (id) => id === 'expo/config-plugins' ? { withDangerousMod: (_, [, cb]) => cb } : require(id);
  requireMock.resolve = require.resolve;
  new Function('require', 'module', 'exports', current)(requireMock, module, module.exports);
  const apply = () => module.exports({})({ modRequest: { projectRoot: path.resolve(old.packageRoot, '../../..') } });
  await apply();
  const upgraded = old.read(); await apply();
  assert.deepEqual(old.read(), upgraded);
  assert.ok(upgraded[0].includes('ReaderHighlightMenuPresenter('));
  assert.ok(upgraded[1].includes('Prop("readerHighlightMenuRequest")'));
});

test('a partial highlight upgrade fails before mutating any target', async (t) => {
  const { apply, read, ios } = fixture(t);
  await apply();
  const file = path.join(ios, 'DomWebViewModule.swift');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('view.readerHighlightMenuRequest = request', 'view.readerHighlightMenuRequest = upstreamChange'));
  const before = read();
  await assert.rejects(apply(), /Incomplete reader highlight-menu prop/);
  assert.deepEqual(read(), before);
});

test('a changed patch target fails before mutating other dependency files', async (t) => {
  const { apply, read, ios } = fixture(t);
  const file = path.join(ios, 'DomWebViewModule.swift');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Events("onMessage", "onContentProcessDidTerminate")', 'Events("upstreamChanged")'));
  const before = read(); await assert.rejects(apply(), /target not found/); assert.deepEqual(read(), before);
});

test('unsupported versions and partial patches fail with recovery instructions', async (t) => {
  const { apply, read, ios, packageRoot } = fixture(t);
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '58.0.0' }));
  const before = read(); await assert.rejects(apply(), /expects.*57\.0\.1/); assert.deepEqual(read(), before);
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '57.0.1' }));
  fs.appendFileSync(path.join(ios, 'DomWebView.swift'), '\n// READER_EDIT_MENU_INTEGRATION\n');
  await assert.rejects(apply(), /Incomplete.*Reinstall dependencies/);
});
