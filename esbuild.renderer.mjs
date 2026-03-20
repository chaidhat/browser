import { build } from 'esbuild';
import { execSync } from 'child_process';

// Build Tailwind CSS
execSync('npx @tailwindcss/cli -i ui/tailwind.css -o dist/tailwind.out.css --minify', { stdio: 'inherit' });

// Build renderer JS
await build({
  entryPoints: ['src/renderer.tsx'],
  bundle: true,
  outfile: 'dist/renderer.bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
  jsx: 'automatic',
  loader: { '.png': 'dataurl' },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

// Build main process JS (bundle node_modules so packaged app doesn't need them)
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});
