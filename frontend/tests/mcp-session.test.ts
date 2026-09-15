import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionFile, sessionPath } from '../scripts/mcp-session.ts';

const url = 'https://prod.supabase.co';
const session = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1 });

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'commonplace-mcp-'));
  path = join(dir, 'nested', 'session.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('sessionPath', () => {
  it('prefers XDG_CONFIG_HOME', () => {
    expect(sessionPath({ XDG_CONFIG_HOME: '/x' })).toBe('/x/commonplace/session.json');
  });

  it('falls back to ~/.config', () => {
    expect(sessionPath({})).toMatch(/\/\.config\/commonplace\/session\.json$/);
  });
});

describe('sessionFile', () => {
  it('reads nothing when the file is missing', async () => {
    expect(await sessionFile(path, url).getItem('k')).toBeNull();
  });

  it('writes an owner-only file tagged with the project URL and reads it back', async () => {
    const storage = sessionFile(path, url);
    await storage.setItem('k', session);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ url, session: JSON.parse(session) });
    expect(await storage.getItem('k')).toBe(session);
  });

  it('treats a session for another project as no session', async () => {
    await sessionFile(path, url).setItem('k', session);
    expect(await sessionFile(path, 'https://dev.supabase.co').getItem('k')).toBeNull();
  });

  it('treats an unreadable file as no session', async () => {
    await sessionFile(path, url).setItem('k', session);
    await writeFile(path, 'not json');
    expect(await sessionFile(path, url).getItem('k')).toBeNull();
  });

  it('sees a change another process wrote', async () => {
    const storage = sessionFile(path, url);
    await storage.setItem('k', session);
    const rotated = JSON.stringify({ access_token: 'b', refresh_token: 'r2', expires_at: 2 });
    await sessionFile(path, url).setItem('k', rotated);
    expect(await storage.getItem('k')).toBe(rotated);
  });

  it('removes the file, and removing twice is fine', async () => {
    const storage = sessionFile(path, url);
    await storage.setItem('k', session);
    await storage.removeItem('k');
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeNull();
  });
});
