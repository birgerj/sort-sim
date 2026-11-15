// The game's own server: it serves the built site and scores plans. One process, one database
// file. Settings come from the environment: PORT (8080), DATA (./data), SITE (./dist),
// WAIT_MS (5000), TRUST_PROXY (1 when behind a reverse proxy that sets X-Forwarded-For),
// RUN_AS (uid:gid to go on as when started as root, as the container does).
import { chownSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { App } from './app';
import { Store } from './store';

const PORT = Number(process.env.PORT ?? 8080);
const DATA = resolve(process.env.DATA ?? 'data');
const SITE = resolve(process.env.SITE ?? 'dist');
const WAIT_MS = Number(process.env.WAIT_MS ?? 5000);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

mkdirSync(DATA, { recursive: true });
// In a container the process starts as root so it can take over a data folder that the host
// made (a mounted folder is often owned by someone else), then goes on as an ordinary user.
const RUN_AS = /^(\d+):(\d+)$/.exec(process.env.RUN_AS ?? '');
if (RUN_AS && process.getuid?.() === 0) {
  const [uid, gid] = [Number(RUN_AS[1]), Number(RUN_AS[2])];
  for (const f of [DATA, ...readdirSync(DATA).map((n) => join(DATA, n))]) chownSync(f, uid, gid);
  process.setgid!(gid);
  process.setuid!(uid);
}
const store = new Store(join(DATA, 'scores.db'));
const app = new App(store, { waitMs: WAIT_MS, atOnce: 2, now: () => Date.now() });

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };

function address(req: IncomingMessage): string {
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() : '';
  return fwd || req.socket.remoteAddress || 'unknown';
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((done, fail) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch (e) {
        fail(e as Error);
      }
    });
    req.on('error', fail);
  });
}

function file(req: IncomingMessage, res: ServerResponse, path: string): void {
  const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
  let full = join(SITE, rel);
  if (!full.startsWith(SITE)) return send(res, 404, { error: 'Not found.' });
  if (existsSync(full) && statSync(full).isDirectory()) full = join(full, 'index.html');
  if (!existsSync(full)) return send(res, 404, { error: 'Not found.' });
  const hashed = /[/\\]assets[/\\]/.test(full);
  res.writeHead(200, { 'content-type': TYPES[extname(full)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache', 'content-length': statSync(full).size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(full).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  void (async () => {
    if (path === '/api/health') return send(res, 200, { ok: true });
    if (path === '/api/run' && req.method === 'POST') {
      let input: unknown;
      try {
        input = await readJson(req, 64 * 1024);
      } catch {
        return send(res, 400, { error: 'This is not a plan for a level of the game.' });
      }
      const reply = app.run(input, address(req));
      setTimeout(() => {
        app.release(reply.held);
        send(res, reply.status, reply.body);
      }, reply.wait ?? 0);
      return;
    }
    if (path === '/api/name' && req.method === 'POST') {
      let input: unknown;
      try {
        input = await readJson(req, 1024);
      } catch {
        return send(res, 400, { error: 'No player or no name.' });
      }
      const reply = app.name(input);
      return send(res, reply.status, reply.body);
    }
    if (path === '/api/ranking' && req.method === 'GET') {
      const level = url.searchParams.get('level');
      const reply = app.ranking(level == null ? null : Number(level), url.searchParams.get('key'));
      return send(res, reply.status, reply.body);
    }
    if (path === '/api/mine' && req.method === 'GET') {
      const reply = app.mine(url.searchParams.get('key'));
      return send(res, reply.status, reply.body);
    }
    if (path.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Not allowed.' });
    file(req, res, path);
  })().catch(() => send(res, 500, { error: 'Something went wrong on the server.' }));
});

server.listen(PORT, () => console.log(`Ten Shifts server on port ${PORT}, site ${SITE}, data ${DATA}`));
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
