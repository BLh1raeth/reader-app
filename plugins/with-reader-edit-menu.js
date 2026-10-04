const fs = require('fs');
const path = require('path');

const { withDangerousMod } = require('expo/config-plugins');

const IMPORT_MARKER = 'import ReaderEditMenu';
const WEBVIEW_MARKER = '// READER_EDIT_MENU_WEBVIEW_INTEGRATION';
const VIEW_MARKER = '// READER_EDIT_MENU_INTEGRATION';
const MODULE_MARKER = 'Prop("readerEditMenuEnabled")';
const POD_MARKER = "s.dependency 'ReaderEditMenu'";

function replaceOnce(source, needle, replacement, filePath) {
  if (!source.includes(needle)) {
    throw new Error(`Reader edit-menu patch target not found in ${filePath}: ${needle}`);
  }
  return source.replace(needle, replacement);
}

function patchDomWebView(filePath) {
  let source = fs.readFileSync(filePath, 'utf8');
  const markers = [IMPORT_MARKER, WEBVIEW_MARKER, VIEW_MARKER, 'override func buildMenu(with builder: UIMenuBuilder)', 'private func updateReaderEditMenuIntegration()'];
  if (markers.every((marker) => source.includes(marker))) return source;
  if (markers.some((marker) => source.includes(marker))) {
    throw new Error(`Incomplete reader edit-menu patch in ${filePath}. Reinstall dependencies before prebuild.`);
  }

  source = replaceOnce(
    source,
    'import WebKit\n',
    `import WebKit\n${IMPORT_MARKER}\n`,
    filePath,
  );
  source = replaceOnce(
    source,
    'final class DomWKWebView: WKWebView {\n  var hidesInputAccessoryView = false\n',
    `final class DomWKWebView: WKWebView {\n  ${WEBVIEW_MARKER}\n  var readerEditMenuCoordinator: ReaderEditMenuCoordinator?\n  var hidesInputAccessoryView = false\n`,
    filePath,
  );
  source = replaceOnce(
    source,
    '  override var inputAccessoryView: UIView? {\n    hidesInputAccessoryView ? nil : super.inputAccessoryView\n  }\n',
    `  override var inputAccessoryView: UIView? {\n    hidesInputAccessoryView ? nil : super.inputAccessoryView\n  }\n\n  override func buildMenu(with builder: UIMenuBuilder) {\n    super.buildMenu(with: builder)\n    readerEditMenuCoordinator?.buildMenu(with: builder)\n  }\n`,
    filePath,
  );
  source = replaceOnce(
    source,
    '  private let onContentProcessDidTerminate = EventDispatcher()\n',
    `  private let onContentProcessDidTerminate = EventDispatcher()\n\n  ${VIEW_MARKER}\n  internal let onReaderSelectionAction = EventDispatcher()\n  internal var readerEditMenuEnabled = false {\n    didSet { updateReaderEditMenuIntegration() }\n  }\n`,
    filePath,
  );
  source = replaceOnce(
    source,
    '  deinit {\n',
    '  deinit {\n    webView?.readerEditMenuCoordinator = nil\n',
    filePath,
  );
  source = replaceOnce(
    source,
    '  // MARK: - Public methods\n',
    `  private func updateReaderEditMenuIntegration() {\n    guard readerEditMenuEnabled, let webView else {\n      webView?.readerEditMenuCoordinator = nil\n      return\n    }\n    guard webView.readerEditMenuCoordinator == nil else { return }\n    webView.readerEditMenuCoordinator = ReaderEditMenuCoordinator(\n      actionHandler: { [weak self] action in\n        self?.onReaderSelectionAction(["action": action])\n      }\n    )\n  }\n\n  // MARK: - Public methods\n`,
    filePath,
  );
  source = replaceOnce(
    source,
    '    self.webView = webView\n    addSubview(webView)\n',
    '    self.webView = webView\n    addSubview(webView)\n    updateReaderEditMenuIntegration()\n',
    filePath,
  );
  return source;
}

function patchDomWebViewModule(filePath) {
  let source = fs.readFileSync(filePath, 'utf8');
  if (source.includes(MODULE_MARKER) && source.includes('"onReaderSelectionAction"')) return source;
  if (source.includes(MODULE_MARKER) || source.includes('"onReaderSelectionAction"')) {
    throw new Error(`Incomplete reader edit-menu patch in ${filePath}. Reinstall dependencies before prebuild.`);
  }
  source = replaceOnce(
    source,
    '      Events("onMessage", "onContentProcessDidTerminate")\n',
    '      Events("onMessage", "onContentProcessDidTerminate", "onReaderSelectionAction")\n',
    filePath,
  );
  source = replaceOnce(
    source,
    '      Prop("hideKeyboardAccessoryView") { (view: DomWebView, hidden: Bool) in\n        view.hideKeyboardAccessoryView = hidden\n      }\n',
    `      Prop("hideKeyboardAccessoryView") { (view: DomWebView, hidden: Bool) in\n        view.hideKeyboardAccessoryView = hidden\n      }\n\n      ${MODULE_MARKER} { (view: DomWebView, enabled: Bool) in\n        view.readerEditMenuEnabled = enabled\n      }\n`,
    filePath,
  );
  return source;
}

function patchPodspec(filePath) {
  let source = fs.readFileSync(filePath, 'utf8');
  if (source.includes(POD_MARKER)) return source;
  source = replaceOnce(
    source,
    "  s.dependency 'ExpoModulesCore'\n",
    `  s.dependency 'ExpoModulesCore'\n  ${POD_MARKER}\n`,
    filePath,
  );
  return source;
}

module.exports = function withReaderEditMenu(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const packageJsonPath = require.resolve('@expo/dom-webview/package.json', {
        paths: [modConfig.modRequest.projectRoot],
      });
      const packageRoot = path.dirname(packageJsonPath);
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.version !== '57.0.1') {
        throw new Error(`Reader edit-menu integration expects @expo/dom-webview 57.0.1, found ${packageJson.version}.`);
      }
      // Resolve all patch targets first. An upstream change must fail before
      // mutating any dependency file, rather than leaving a partial install.
      const patches = [
        ['DomWebView.swift', patchDomWebView],
        ['DomWebViewModule.swift', patchDomWebViewModule],
        ['ExpoDomWebView.podspec', patchPodspec],
      ].map(([name, patch]) => {
        const filePath = path.join(packageRoot, 'ios', name);
        return { filePath, before: fs.readFileSync(filePath, 'utf8'), after: patch(filePath) };
      });
      try {
        for (const { filePath, after } of patches) fs.writeFileSync(filePath, after);
      } catch (error) {
        for (const { filePath, before } of patches) {
          try { fs.writeFileSync(filePath, before); } catch { /* Preserve the original failure. */ }
        }
        throw error;
      }
      return modConfig;
    },
  ]);
};
