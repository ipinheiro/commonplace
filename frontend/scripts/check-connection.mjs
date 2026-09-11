import { readFile } from 'node:fs/promises';

try {
  const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of text.split('\n')) {
    const match = /^(VITE_SUPABASE_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Configure the project URL and publishable key first.');

const settings = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key },
  signal: AbortSignal.timeout(15_000),
});
console.log('Auth settings HTTP status:', settings.status);
if (!settings.ok) process.exitCode = 1;
else {
  const auth = await settings.json();
  console.log('Public registration disabled:', auth.disable_signup === true);
  if (auth.disable_signup !== true) process.exitCode = 1;
}

for (const schema of ['api', 'app']) {
  const response = await fetch(`${url}/rest/v1/rpc/list_entries`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', 'Content-Profile': schema },
    body: '{}',
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  console.log(`${schema}: anonymous RPC HTTP ${response.status}, code ${result.code ?? 'none'}`);
  if (schema === 'api' && result.code !== '42501') process.exitCode = 1;
  if (schema === 'app' && result.code !== 'PGRST106') process.exitCode = 1;
}
