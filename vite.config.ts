import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works on GitHub Pages under /sort-sim/.
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
