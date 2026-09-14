import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

// Mirrors check-connection.mjs: the env file is optional and never overrides the environment.
export async function loadLocalEnv(): Promise<void> {
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

export async function ask(question: string): Promise<string> {
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

export function askHidden(question: string): Promise<string> {
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
