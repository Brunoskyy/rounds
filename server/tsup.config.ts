import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  // The shared workspace is TypeScript source; bundle it in.
  noExternal: ['@rounds/shared'],
  // esbuild's node22 target predates node:sqlite and would rewrite the import.
  external: ['node:sqlite', 'ws'],
  sourcemap: true,
  clean: true,
})
