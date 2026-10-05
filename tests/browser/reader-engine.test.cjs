const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const JSZip = require('jszip');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
function epubFixture(baseUrl = '') {
  return {
    'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/book.opf': '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试阅读</dc:title><dc:identifier id="id">review-fixture</dc:identifier><dc:language>zh-CN</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="image" href="pixel.png" media-type="image/png"/><item id="style" href="book.css" media-type="text/css"/><item id="nested-style" href="nested.css" media-type="text/css"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    'OEBPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章</a></li></ol></nav></body></html>',
    'OEBPS/chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>正文</title><link rel="stylesheet" href="book.css"/><script>window.parent.bookScriptRan = true;</script><style>p { line-height: 1.7; }</style></head><body><p id="first" onclick="window.parent.bookHandlerRan = true">阅读测试，脚注<a id="reference" epub:type="noteref" href="#note">[1]</a>。</p><img id="local-image" src="pixel.png"/><img src="/remote-image"/><a id="unsafe" href="javascript:window.parent.bookScriptRan=true">危险链接</a><aside id="note" epub:type="footnote"><p>这是一条脚注。</p></aside>${Array.from({ length: 30 }, (_, i) => `<p>第${i + 1}段，${'用于验证中文分页和阅读定位。'.repeat(15)}</p>`).join('')}</body></html>`,
    'OEBPS/book.css': '@import "nested.css";',
    'OEBPS/nested.css': '#first { border-top: 3px solid rgb(1, 2, 3); }',
    'OEBPS/pixel.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9yQAAAAASUVORK5CYII=', 'base64'),
  };
}

test('real Foliate reader blocks book scripts and remote assets while preserving reading, images, footnotes and restore',
  { timeout: 60000 }, async (t) => {
    let remoteRequests = 0;
    const server = http.createServer((req, res) => {
      const requested = new URL(req.url, 'http://localhost').pathname;
      if (requested === '/remote-image') { remoteRequests++; res.end(); return; }
      if (requested === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><head></head><body style="margin:0"><div id="reader" style="width:390px;height:760px"></div></body></html>');
        return;
      }
      let file = path.resolve(root, `.${requested}`);
      if (!file.startsWith(root + path.sep)
        || !(requested.startsWith('/src/') || requested.startsWith('/node_modules/foliate-js/'))) {
        res.writeHead(404); res.end(); return;
      }
      if (!path.extname(file)) file += '.ts';
      try {
        let content = fs.readFileSync(file, 'utf8');
        if (file.endsWith('.ts')) {
          content = ts.transpileModule(content, { compilerOptions: {
            module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
          } }).outputText.replace(/(['"])foliate-js\//g, '$1/node_modules/foliate-js/');
        }
        res.setHeader('Content-Type', 'text/javascript'); res.end(content);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.stack || String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await page.evaluate(async (baseUrl) => {
      const frame = document.createElement('iframe');
      frame.srcdoc = `<img src="${baseUrl}/remote-image" />`;
      document.body.append(frame);
      await new Promise((resolve) => { frame.onload = resolve; });
      frame.remove();
    }, baseUrl);
    assert.equal(remoteRequests, 1, 'the same-origin image endpoint must be reachable');
    remoteRequests = 0;
    for (const format of ['epub3', 'epub2']) {
    const fixture = epubFixture(baseUrl);
    if (format === 'epub2') {
      fixture['OEBPS/book.opf'] = fixture['OEBPS/book.opf'].replace('version="3.0"', 'version="2.0"')
        .replace('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>')
        .replace('<spine>', '<spine toc="ncx">');
      delete fixture['OEBPS/nav.xhtml'];
      fixture['OEBPS/toc.ncx'] = '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>测试阅读</text></docTitle><navMap><navPoint id="chapter" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>';
    }
    fixture['OEBPS/chapter.xhtml'] = fixture['OEBPS/chapter.xhtml'].replace('src="/remote-image"', `src="${baseUrl}/remote-image"`);
    const entries = Object.fromEntries(Object.entries(fixture).map(([name, value]) =>
      [name, Buffer.from(value).toString('base64')]));
    const zip = new JSZip();
    for (const [name, value] of Object.entries(fixture)) zip.file(name, value);
    const base64 = await zip.generateAsync({ type: 'base64' });
    for (const sourceKind of ['zip-resource-loader', 'full-base64-fallback']) {
      const result = await page.evaluate(async ({ entries, base64, sourceKind }) => {
        window.__DEV__ = false;
        const { FoliateEpubEngineAdapter } = await import('/src/features/reader/foliate/FoliateEpubEngineAdapter.ts');
        const { DEFAULT_READER_SETTINGS } = await import('/src/features/reader/reader-settings.ts');
        const host = document.querySelector('#reader');
        window.footnote = null;
        let chromeTaps = 0;
        window.highlightTap = null;
        const engine = new FoliateEpubEngineAdapter(host, () => {}, () => { chromeTaps++; }, () => {}, () => {}, () => {},
          () => {}, (payload) => { window.footnote = payload; }, () => false,
          (payload) => { window.highlightTap = payload; });
        const input = {
          bookId: 'fixture', fileName: 'fixture.epub', sourceKind, base64,
          entries: Object.entries(entries).map(([name, encoded]) => ({ name, uncompressedSize: atob(encoded).length })),
          onResourceRequest: async (name) => entries[name] ? { base64: entries[name] } : null,
          restoreCfi: null, pageCountCache: null, readerSettings: DEFAULT_READER_SETTINGS,
        };
        const opened = await engine.open(input);
        const frame = host.querySelector('foliate-view').renderer.getContents()[0].doc;
        await new Promise((resolve) => setTimeout(resolve, 100));
        const image = frame.querySelector('#local-image');
        frame.querySelector('#first').click();
        frame.querySelector('#reference').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const footnote = window.footnote?.text;
        const safe = !window.bookScriptRan && !window.bookHandlerRan
          && !frame.querySelector('#unsafe').getAttribute('href');
        const localStylesLoaded = getComputedStyle(frame.querySelector('#first')).borderTopWidth === '3px';
        const localImageLoaded = image.complete && image.naturalWidth > 0;
        // Resolve a real painted CFI and exercise iframe pointer hit-testing.
        // Offset + scale the host so accidentally sending iframe-local pixels
        // or adding a safe-area/device scale a second time cannot pass.
        host.style.marginLeft = '17px'; host.style.marginTop = '23px';
        host.style.transform = 'scale(0.9)'; host.style.transformOrigin = '0 0';
        const highlightView = host.querySelector('foliate-view');
        const range = frame.createRange();
        const firstText = frame.querySelector('#first').firstChild;
        range.setStart(firstText, 0); range.setEnd(firstText, 4);
        const rangeCfi = highlightView.getCFI(0, range);
        await engine.addAnnotation(rangeCfi, 0);
        const rect = range.getClientRects()[0];
        const iframe = frame.defaultView.frameElement;
        const iframeRect = iframe.getBoundingClientRect();
        const expectedRect = {
          x: iframeRect.left + rect.left * iframeRect.width / iframe.clientWidth,
          y: iframeRect.top + rect.top * iframeRect.height / iframe.clientHeight,
          width: rect.width * iframeRect.width / iframe.clientWidth,
          height: rect.height * iframeRect.height / iframe.clientHeight,
        };
        const tapHighlight = () => {
          const init = { bubbles: true, isPrimary: true, pointerId: 1,
            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
            screenX: 195, screenY: 120 };
          frame.querySelector('#first').dispatchEvent(new frame.defaultView.PointerEvent('pointerdown', init));
          frame.querySelector('#first').dispatchEvent(new frame.defaultView.PointerEvent('pointerup', init));
        };
        const beforeTapCfi = engine.getLocation().cfi;
        tapHighlight();
        const highlightTap = window.highlightTap;
        const highlightTextMatchesCfi = highlightTap && highlightView.resolveCFI(highlightTap.rangeCfi).anchor(frame).toString().trim() === highlightTap.text;
        const highlightTapLeavesPage = engine.getLocation().cfi === beforeTapCfi && chromeTaps === 0;
        const noDeleteBubble = !frame.querySelector('[data-reader-highlight-bubble]');
        const paintKeptUntilDelete = engine.highlightRanges.get(frame)?.some((item) => item.rangeCfi === rangeCfi);
        await engine.removeAnnotation(rangeCfi);
        const highlightRemoved = !engine.highlightRanges.get(frame)?.some((item) => item.rangeCfi === rangeCfi) && window.highlightTap === null;
        await engine.addAnnotation(rangeCfi, 0); tapHighlight();
        host.style.marginLeft = ''; host.style.marginTop = ''; host.style.transform = '';
        await engine.next();
        const highlightDismissedOnTurn = window.highlightTap === null;
        const beforeFontChange = engine.getLocation().cfi;
        engine.setSettingsSessionActive(true);
        await engine.applySettings({ ...DEFAULT_READER_SETTINGS, fontFamily: 'serif', fontSize: 24 });
        const view = host.querySelector('foliate-view');
        const documentAfter = view.renderer.getContents()[0].doc;
        const anchor = view.resolveCFI(beforeFontChange).anchor(documentAfter);
        const visible = view.lastLocation.range;
        const fontAnchorVisible = visible.compareBoundaryPoints(Range.END_TO_START, anchor) <= 0
          && visible.compareBoundaryPoints(Range.START_TO_END, anchor) >= 0;
        const fontApplied = view.renderer.getContents()[0].doc.querySelector('style[data-reader-style]')?.textContent?.includes('Songti')
          || getComputedStyle(documentAfter.body).fontFamily.includes('Songti');
        // During an iframe replacement contentDocument can outlive its body.
        // A queued Foliate ResizeObserver render must wait for the next live
        // section instead of dereferencing null body.style.
        const documentBody = documentAfter.body;
        documentBody.remove();
        let unguardedLayoutFailed = false;
        try { Object.getPrototypeOf(view.renderer).render.call(view.renderer); }
        catch (error) { unguardedLayoutFailed = /style/.test(String(error)); }
        view.renderer.render();
        documentAfter.documentElement.append(documentBody);
        engine.destroy();
        const restored = await engine.open({ ...input, restoreCfi: opened.cfi });
        engine.destroy();
        return { safe, localStylesLoaded, localImageLoaded, footnote, fontAnchorVisible, fontApplied,
          highlightTap, expectedRect, highlightTextMatchesCfi, highlightTapLeavesPage, noDeleteBubble,
          paintKeptUntilDelete, highlightRemoved, highlightDismissedOnTurn, unguardedLayoutFailed, cfi: opened.cfi, restoredCfi: restored.cfi };
      }, { entries, base64, sourceKind });
      assert.equal(result.safe, true, sourceKind);
      assert.equal(result.localImageLoaded, true, sourceKind);
      assert.equal(result.localStylesLoaded, true, 'bundled CSS imports remain available');
      assert.match(result.footnote, /这是一条脚注/);
      assert.equal(result.fontAnchorVisible, true, 'font repagination preserves the visible CFI anchor');
      assert.equal(result.fontApplied, true, 'the serif font preference reaches the chapter');
      assert.equal(result.highlightTap?.text, '阅读测试');
      assert.equal(result.highlightTap?.bookId, 'fixture');
      assert.equal(result.highlightTextMatchesCfi, true, 'highlight text round-trips through its range CFI');
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(result.highlightTap.rect[key] - result.expectedRect[key]) < 0.01, `highlight anchor ${key} maps to the WebView viewport once`);
      }
      assert.equal(result.highlightTapLeavesPage, true, 'highlight taps do not turn pages or toggle chrome');
      assert.equal(result.noDeleteBubble, true, 'the abandoned DOM delete bubble is absent');
      assert.equal(result.paintKeptUntilDelete, true, 'opening a menu does not delete its highlight');
      assert.equal(result.highlightRemoved, true, 'explicit removal clears the paint and menu request');
      assert.equal(result.highlightDismissedOnTurn, true, 'page navigation invalidates the menu anchor');
      assert.equal(result.unguardedLayoutFailed, true, 'the missing-body fixture reproduces Foliate\'s null-style error while the guarded render succeeds');
      assert.match(result.cfi, /^epubcfi\(/);
      assert.equal(result.restoredCfi, result.cfi, sourceKind);
    }
    }
    assert.equal(remoteRequests, 0);
    assert.deepEqual(errors, []);
  });
