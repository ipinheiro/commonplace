import { createClient } from '@supabase/supabase-js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode, exportBook, type ExportClient, type ExportSummary } from './export-core.ts';
import { ask, askHidden, loadLocalEnv } from './terminal.ts';

function outputDir(argv: string[]): string {
  const flag = argv.indexOf('--out');
  const allowed = flag === -1 ? new Set<number>() : new Set([flag, flag + 1]);
  for (const [index, arg] of argv.entries()) {
    if (!allowed.has(index)) throw new Error('Unknown argument: ' + arg);
  }
  if (flag === -1) return fileURLToPath(new URL('../../export/', import.meta.url));
  const value = argv[flag + 1];
  if (!value || value.startsWith('--')) throw new Error('--out needs a directory.');
  return resolve(value);
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
