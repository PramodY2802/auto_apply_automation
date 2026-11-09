import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false, setupFiles: ['./test/setup.ts'] },
});
