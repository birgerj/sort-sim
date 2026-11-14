// Builds the game's server (server/index.ts, with the score model inside it) into one file.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'server/index.ts',
    copyPublicDir: false,
    outDir: 'dist-server',
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
  ssr: { noExternal: true },
});
