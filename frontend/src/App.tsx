import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { signOut, watchSession, type Viewer } from './data/auth';
import { isConfigured } from './data/supabase';
import { Book } from './features/Book';
import { SignIn } from './features/SignIn';

export function App() {
  const client = useQueryClient();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [remembered, setRemembered] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(isConfigured);
  const [logoutError, setLogoutError] = useState('');
  const previousId = useRef<string | null>(null);
  useEffect(
    () =>
      watchSession((next) => {
        if (next?.id !== previousId.current) client.clear();
        previousId.current = next?.id ?? null;
        setViewer(next);
        setLoading(false);
        if (next) setRemembered(next);
      }),
    [client],
  );
  async function logout() {
    if (!window.confirm('Sign out and discard any open draft?')) return;
    try {
      await signOut();
      client.clear();
      setRemembered(null);
      setViewer(null);
      setLogoutError('');
      window.location.hash = '';
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'Could not sign out.');
    }
  }
  if (!isConfigured)
    return (
      <main className="welcome">
        <div className="book-mark">c.</div>
        <h1>A home for what stays with you.</h1>
        <p>This copy of Commonplace is waiting to be connected.</p>
        <p className="muted">The setup guide has the next steps.</p>
      </main>
    );
  if (loading)
    return (
      <main className="welcome">
        <div className="book-mark">c.</div>
        <p role="status">Opening your book…</p>
      </main>
    );
  return (
    <>
      {/* Keep only the in-memory editor mounted during expired authentication.
        A different account gets a new component tree; explicit logout removes it. */}
      {remembered && (
        <div hidden={!viewer} key={remembered.id}>
          {logoutError && (
            <p className="notice error" role="alert">
              {logoutError}
            </p>
          )}
          <Book
            viewer={remembered}
            active={Boolean(viewer)}
            onSignOut={() => void logout()}
            onReauthenticate={() => {
              client.clear();
              setViewer(null);
            }}
          />
        </div>
      )}
      {!viewer && <SignIn expired={Boolean(remembered)} />}
    </>
  );
}
