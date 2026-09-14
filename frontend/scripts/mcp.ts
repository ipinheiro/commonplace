import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@supabase/supabase-js';
import { registerTools, type BookClient } from './mcp-core.ts';
import { sessionFile, sessionPath } from './mcp-session.ts';
import { ask, askHidden, loadLocalEnv } from './terminal.ts';

async function main(argv: string[]): Promise<number> {
  const command = argv[0] ?? 'serve';
  if (!['serve', 'login', 'logout'].includes(command) || argv.length > 1) {
    console.error('Usage: mcp [login | logout]   (no argument serves MCP over stdio)');
    return 1;
  }
  await loadLocalEnv();
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || key.includes('replace_me')) {
    console.error('Configure the project URL and publishable key in frontend/.env.local first.');
    return 1;
  }
  const path = sessionPath();
  const storage = sessionFile(path, url);
  const supabase = createClient(url, key, {
    db: { schema: 'api' },
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: command === 'serve',
      detectSessionInUrl: false,
    },
  });

  if (command === 'login') {
    const email = process.env.COMMONPLACE_EMAIL || (await ask('Email: '));
    const password = process.env.COMMONPLACE_PASSWORD || (await askHidden('Password: '));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Could not sign in. Check the email and password, then try again.');
      return 1;
    }
    console.log('Signed in. Session saved to', path);
    return 0;
  }

  if (command === 'logout') {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('The session could not be revoked remotely:', error.message);
    await storage.removeItem('');
    console.log('Signed out. Removed', path);
    return error ? 1 : 0;
  }

  const client: BookClient = {
    async signedIn() {
      const { data } = await supabase.auth.getSession();
      return data.session !== null;
    },
    async rpc(name, args) {
      const { data, error } = await supabase.rpc(name, args);
      return { data, error: error ? { code: error.code ?? 'unknown' } : null };
    },
  };
  const server = new McpServer({ name: 'commonplace', version: '0.1.0' });
  registerTools(server, client);
  // The token refresh timer would otherwise keep the process alive after the client goes away.
  process.stdin.once('end', () => process.exit(0));
  await server.connect(new StdioServerTransport());
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
