import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'commonplace', 'session.json');
}

// One file holds one session, so the storage key supabase-js passes is ignored. The file
// is read on every access rather than cached: two servers running at once (Claude Code
// and Codex) then both see the latest refreshed token instead of one of them refreshing
// with a token the other has already rotated.
export function sessionFile(path: string, url: string): SessionStorage {
  return {
    async getItem() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      let stored: unknown;
      try {
        stored = JSON.parse(text);
      } catch {
        return null;
      }
      if (typeof stored !== 'object' || stored === null) return null;
      const { url: storedUrl, session } = stored as { url?: unknown; session?: unknown };
      if (storedUrl !== url || session === undefined) return null;
      return JSON.stringify(session);
    },
    async setItem(_key, value) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const part = `${path}.${process.pid}.part`;
      await writeFile(part, JSON.stringify({ url, session: JSON.parse(value) }) + '\n', {
        mode: 0o600,
      });
      await rename(part, path);
    },
    async removeItem() {
      await rm(path, { force: true });
    },
  };
}
