import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['app/test/**/*.spec.ts', 'app/src/**/*.spec.ts'] } });
