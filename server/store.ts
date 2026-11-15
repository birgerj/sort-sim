// What the server remembers: every player's best result per level. One small database file.
import { DatabaseSync } from 'node:sqlite';

export interface Entry {
  /** The player's key: for the server only, never sent out. */
  key: string;
  name: string;
  country: string;
  score: number;
  stars: number;
  badge: boolean;
}

export interface TotalEntry {
  key: string;
  name: string;
  country: string;
  total: number;
  levels: number;
  stars: number;
  badges: number;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (key TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS best (key TEXT NOT NULL, level INTEGER NOT NULL, score INTEGER NOT NULL, profit REAL NOT NULL, stars INTEGER NOT NULL, badge INTEGER NOT NULL, plan TEXT NOT NULL, at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (key, level));
      CREATE INDEX IF NOT EXISTS best_level ON best (level, score DESC, at);
    `);
  }

  /** Remembers who played (the name and country may have changed since the last time). */
  seen(key: string, name: string, country: string, now: number): void {
    this.db.prepare(`INSERT INTO players (key, name, country, seen) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET name = excluded.name, country = excluded.country, seen = excluded.seen`).run(key, name, country, now);
  }

  /** Keeps a result when it beats the player's best on that level; counts every try. A badge once earned stays. */
  record(key: string, level: number, r: { score: number; profit: number; stars: number; badge: boolean }, plan: string, now: number): void {
    const old = this.db.prepare(`SELECT score, badge, tries FROM best WHERE key = ? AND level = ?`).get(key, level) as { score: number; badge: number; tries: number } | undefined;
    if (!old) {
      this.db.prepare(`INSERT INTO best (key, level, score, profit, stars, badge, plan, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(key, level, r.score, r.profit, r.stars, r.badge ? 1 : 0, plan, now);
    } else if (r.score > old.score) {
      this.db.prepare(`UPDATE best SET score = ?, profit = ?, stars = ?, badge = ?, plan = ?, at = ?, tries = tries + 1 WHERE key = ? AND level = ?`).run(r.score, r.profit, r.stars, r.badge || old.badge ? 1 : 0, plan, now, key, level);
    } else {
      this.db.prepare(`UPDATE best SET badge = ?, tries = tries + 1 WHERE key = ? AND level = ?`).run(r.badge || old.badge ? 1 : 0, key, level);
    }
  }

  /** The best scores on one level; an earlier result ranks above a later equal one. */
  level(level: number, limit: number): Entry[] {
    const rows = this.db.prepare(`SELECT b.key, p.name, p.country, b.score, b.stars, b.badge FROM best b JOIN players p ON p.key = b.key WHERE b.level = ? ORDER BY b.score DESC, b.at ASC LIMIT ?`).all(level, limit) as unknown as (Omit<Entry, 'badge'> & { badge: number })[];
    return rows.map((r) => ({ ...r, badge: !!r.badge }));
  }

  /** The sum of each player's best per level. */
  totals(limit: number): TotalEntry[] {
    return this.db.prepare(`SELECT b.key, p.name, p.country, SUM(b.score) AS total, COUNT(*) AS levels, SUM(b.stars) AS stars, SUM(b.badge) AS badges, MAX(b.at) AS last FROM best b JOIN players p ON p.key = b.key GROUP BY b.key ORDER BY total DESC, last ASC LIMIT ?`).all(limit) as unknown as TotalEntry[];
  }

  /** A player's own best per level, so another device with the same key gets its progress back. */
  mine(key: string): { level: number; score: number; stars: number; badge: boolean }[] {
    const rows = this.db.prepare(`SELECT level, score, stars, badge FROM best WHERE key = ? ORDER BY level`).all(key) as unknown as { level: number; score: number; stars: number; badge: number }[];
    return rows.map((r) => ({ ...r, badge: !!r.badge }));
  }

  /** A player's place among all totals (1 = first), or 0 without a result. */
  rank(key: string): number {
    const mine = this.db.prepare(`SELECT SUM(score) AS total FROM best WHERE key = ?`).get(key) as { total: number | null } | undefined;
    if (!mine || mine.total == null) return 0;
    const above = this.db.prepare(`SELECT COUNT(*) AS n FROM (SELECT SUM(score) AS total FROM best GROUP BY key) WHERE total > ?`).get(mine.total) as { n: number };
    return above.n + 1;
  }

  close(): void {
    this.db.close();
  }
}
