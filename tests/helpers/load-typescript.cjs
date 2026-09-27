const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

/** Load production TypeScript in Node while replacing only native modules. */
function createTypeScriptLoader(mocks = {}) {
  const cache = new Map();
  function load(filePath) {
    const absolute = path.resolve(filePath);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = fs.readFileSync(absolute, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: absolute,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const loaded = { exports: {} };
    cache.set(absolute, loaded);
    function requireFromFile(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absolute), id);
        return load(path.extname(resolved) ? resolved : `${resolved}.ts`);
      }
      return require(id);
    }
    new Function('require', 'module', 'exports', '__DEV__', output)(
      requireFromFile, loaded, loaded.exports, false,
    );
    return loaded.exports;
  }
  return load;
}

module.exports = { createTypeScriptLoader };
