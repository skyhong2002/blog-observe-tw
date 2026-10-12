import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server-render tests of the topic pages' 資料來源與計算方式 block (web/test/*.spec.tsx).
// Kept apart from vitest.config.ts (gateway specs) and web's node --test suite; nothing is cached on disk.
export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./web/src/', import.meta.url)) }] },
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: { environment: 'node', include: ['web/test/**/*.spec.tsx'], cache: false, fsModuleCache: false },
});
