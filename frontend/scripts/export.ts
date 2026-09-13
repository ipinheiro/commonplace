import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { exitCode, exportBook, type ExportClient, type ExportSummary } from './export-core.ts';

// Mirrors check-connection.mjs: the env file is optional and never overrides the environment.
async function loadLocalEnv(): Promise<void> {
  try {
    const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^(VITE_SUPABASE_[A-Z_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function outputDir(argv: string[]): string {
  const flag = argv.indexOf('--out');
  for (const [index, arg] of argv.entries()) {
    if (index !== flag && index !== flag + 1) throw new Error('Unknown argument: ' + arg);
  }
  if (flag === -1) return fileURLToPath(new URL('../../export/', import.meta.url));
  const value = argv[flag + 1];
  if (!value || value.startsWith('--')) throw new Error('--out needs a directory.');
  return resolve(value);
}

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Set COMMONPLACE_EMAIL when there is no terminal.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolvePassword, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error('Set COMMONPLACE_PASSWORD when there is no terminal.'));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (done: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      done();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') return finish(() => reject(new Error('Cancelled.')));
        if (char === '\r' || char === '\n') return finish(() => resolvePassword(value));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

function report(summary: ExportSummary, dir: string): void {
  console.log('Exported to', dir);
  console.log('Entries: personal', summary.entries.personal, '· work', summary.entries.work);
  console.log(
    'Images: downloaded',
    summary.imagesDownloaded,
    '· already present',
    summary.imagesSkipped,
  );
  if (summary.removed) console.log('Removed stale entry files:', summary.removed);
  for (const failure of summary.failures)
    console.error('Failed image', failure.path, '·', failure.message);
  if (summary.failures.length)
    console.error('Export finished with', summary.failures.length, 'failed image(s).');
}

async function main(): Promise<number> {
  await loadLocalEnv();
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || key.includes('replace_me')) {
    console.error('Configure the project URL and publishable key in frontend/.env.local first.');
    return 1;
  }
  const dir = outputDir(process.argv.slice(2));
  const email = process.env.COMMONPLACE_EMAIL || (await ask('Email: '));
  const password = process.env.COMMONPLACE_PASSWORD || (await askHidden('Password: '));

  const supabase = createClient(url, key, {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    console.error('Could not sign in. Check the email and password, then try again.');
    return 1;
  }

  const client: ExportClient = {
    async listEntries(args) {
      const { data, error } = await supabase.rpc('list_entries', args);
      if (error) throw new Error('list_entries failed: ' + (error.code ?? 'unknown'));
      return data;
    },
    async downloadImage(path) {
      const { data, error } = await supabase.storage.from('entry-images').download(path);
      if (error || !data) throw new Error(error?.message ?? 'Empty download');
      return new Uint8Array(await data.arrayBuffer());
    },
  };

  try {
    const summary = await exportBook(client, dir);
    report(summary, dir);
    return exitCode(summary);
  } finally {
    await supabase.auth.signOut({ scope: 'local' });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
