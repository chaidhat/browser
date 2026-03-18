import { build } from 'esbuild';

await build({
  entryPoints: ['dist/renderer.js'],
  bundle: true,
  outfile: 'dist/renderer.bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
});
