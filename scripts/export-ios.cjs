const { spawnSync } = require('node:child_process');

// Expo SDK 57 DOM export can retain old common-chunk filenames after its
// asset renaming pass. Use the supported single-bundle export path.
const result = spawnSync(process.execPath, [
  require.resolve('expo/bin/cli'), 'export', '--platform', 'ios', ...process.argv.slice(2),
], { stdio: 'inherit', env: { ...process.env, EXPO_NO_BUNDLE_SPLITTING: '1' } });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
