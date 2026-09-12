import { useState, type FormEvent } from 'react';
import { signIn } from '../data/auth';
import { ArrowUpRight } from './ArrowUpRight';
import { ThemeToggle } from './ThemeToggle';

export function SignIn({ expired = false }: { expired?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="welcome sign-in">
      <div className="welcome-theme">
        <ThemeToggle />
      </div>
      <section className="welcome-story">
        <div className="book-mark" aria-hidden="true">
          c.
        </div>
        <span className="eyebrow">TP1367 9SEP LIS-LHR - here's to everything</span>
        <h1>
          Tear me to pieces, skin to bone
          <br />
          Hello, welcome home.
        </h1>
        <p className="welcome-description">
          Notes, ideas, passages and little discoveries.
          <br />
          Keep them together. Come back to them.
        </p>
      </section>
      <section className="welcome-panel">
        <span className="eyebrow">Commonplace</span>
        <h2>Welcome back.</h2>
        <p className="muted">Sign in to your collection.</p>
        <form className="login-form" onSubmit={submit}>
          {expired && (
            <p className="notice">
              Sign in again to continue. Your open draft is still in this tab.
            </p>
          )}
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Opening your book…' : 'Open your book'} <ArrowUpRight />
          </button>
        </form>
        <p className="small muted">A quiet space, just for you.</p>
      </section>
    </main>
  );
}
