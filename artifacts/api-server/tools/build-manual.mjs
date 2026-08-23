// Bundles the user-manual generator (TSX) so plain node can run it.
// Usage (from artifacts/api-server): node tools/build-manual.mjs && node dist-tools/manual.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await esbuild({
  entryPoints: [path.join(artifactDir, 'src/tools/user-manual/manual.tsx')],
  platform: 'node',
  bundle: true,
  format: 'esm',
  outfile: path.join(artifactDir, 'dist-tools/manual.mjs'),
  outExtension: undefined,
  logLevel: 'info',
  external: ['@react-pdf/renderer', 'react'],
  sourcemap: false,
});
