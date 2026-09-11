import { DataError } from '../domain/entries';
import { supabase } from './supabase';

export type Viewer = { id: string; email: string };

export function watchSession(onChange: (viewer: Viewer | null) => void): () => void {
  if (!supabase) {
    onChange(null);
    return () => {};
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session ? { id: session.user.id, email: session.user.email ?? '' } : null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new DataError('unavailable', 'The book is not connected yet.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error)
    throw new DataError(
      'auth',
      'Could not sign in. Check your email and password, then try again.',
    );
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new DataError('unavailable', 'Could not sign out. Please try again.');
}
