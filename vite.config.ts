import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { BODIES_FILE, encodeBodies } from './src/scene/bakedBodies';

/**
 * Writes the service worker at build time, with the list of every file in the
 * build to keep for offline use (precache) and a version from their contents,
 * so a new build replaces the old cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'sort-sim-service-worker',
    apply: 'build',
    writeBundle(opts) {
      const dir = opts.dir!;
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(dir, p).split('\\').join('/'));
        }
      };
      walk(dir);
      const keep = files.filter((f) => f !== 'sw.js' && !f.startsWith('screens/'));
      const hash = createHash('sha256');
      for (const f of keep.sort()) hash.update(f).update(readFileSync(join(dir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const tpl = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8');
      const out = tpl.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...keep.map((f) => `./${f}`)]));
      // (writeBundle runs after the files are written, so the list is complete.)
      writeFileSync(join(dir, 'sw.js'), out);
    },
  };
}

/**
 * Makes the people's bodies at build time (src/scene/bakedBodies.ts) and writes them next
 * to the page, so the browser only has to read them. (Runs before the service worker's file
 * list is made, so the file is kept for offline use too.)
 */
function bakedBodies(): Plugin {
  return {
    name: 'sort-sim-baked-bodies',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: BODIES_FILE, source: encodeBodies() });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works on GitHub Pages under /sort-sim/.
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [bakedBodies(), serviceWorker()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
