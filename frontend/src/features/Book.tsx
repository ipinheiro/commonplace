import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import type { Viewer } from '../data/auth';
import { getEntry, listEntries } from '../data/knowledge';
import { DataError, type Entry, type EntryCursor } from '../domain/entries';
import { Editor } from './Editor';

function currentEntry(): string | null {
  const match = /^#entry\/([a-f0-9-]{36})$/.exec(window.location.hash);
  return match?.[1] ?? null;
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function Book({
  viewer,
  active,
  onSignOut,
  onReauthenticate,
}: {
  viewer: Viewer;
  active: boolean;
  onSignOut: () => void;
  onReauthenticate: () => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(currentEntry);
  const [editor, setEditor] = useState<{ entry: Entry | null } | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    const onHash = () => setSelected(currentEntry());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        !active ||
        editor ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setEditor({ entry: null });
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [active, editor]);
  const entries = useInfiniteQuery({
    queryKey: ['entries', viewer.id, search],
    enabled: active,
    initialPageParam: null as EntryCursor | null,
    queryFn: ({ pageParam, signal }) => listEntries(search, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const detail = useQuery({
    queryKey: ['entry', viewer.id, selected],
    enabled: active && Boolean(selected),
    queryFn: ({ signal }) => getEntry(selected!, signal),
  });
  function onSaved(entry: Entry) {
    setEditor(null);
    setSavedMessage('Safely tucked into your book.');
    client.setQueryData(['entry', viewer.id, entry.id], entry);
    void client.invalidateQueries({ queryKey: ['entries', viewer.id] });
    window.location.hash = `entry/${entry.id}`;
  }
  const items = entries.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="book-layout">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="mini-mark">c.</span> commonplace<span className="brand-dot">*</span>
        </a>
        <p className="sidebar-note">
          A collection of things
          <br />
          worth keeping.
        </p>
        <button className="primary capture" onClick={() => setEditor({ entry: null })}>
          <span>＋ New entry</span>
          <kbd>N</kbd>
        </button>
        <nav aria-label="Book navigation">
          <a className="nav-item active" href="#">
            <span aria-hidden="true">▤</span> All entries
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="eyebrow">A BOOK OF YOUR OWN</span>
          <p className="small">{viewer.email}</p>
          <button className="text-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="book-main">
        <header className="page-top">
          <span className="eyebrow">COLLECT · CONSIDER · RETURN</span>
          <span className="private-label">
            <span aria-hidden="true">◌</span> Private
          </span>
        </header>
        {savedMessage && (
          <p className="save-status" role="status">
            {savedMessage}
          </p>
        )}
        {selected ? (
          <>
            <a href="#" className="back-link">
              ← Back to your book
            </a>
            {detail.isPending && <p role="status">Opening entry…</p>}
            {detail.error && (
              <div className="notice error" role="alert">
                <p>{detail.error.message}</p>
                {detail.error instanceof DataError && detail.error.code === 'auth' && (
                  <button onClick={onReauthenticate}>Sign in again</button>
                )}
                <button onClick={() => void detail.refetch()}>Try again</button>
              </div>
            )}
            {detail.data && (
              <article className={`entry-detail kind-${detail.data.kind}`}>
                <div className="entry-meta">
                  <span className="type-label">{detail.data.kind}</span>
                  <span>{formatDate(detail.data.createdAt)}</span>
                </div>
                <h1>{detail.data.title}</h1>
                <div className="markdown">
                  <Markdown skipHtml>{detail.data.body}</Markdown>
                </div>
                <footer className="entry-footer">
                  <span className="muted small">Updated {formatDate(detail.data.updatedAt)}</span>
                  <button className="secondary" onClick={() => setEditor({ entry: detail.data! })}>
                    Edit entry
                  </button>
                </footer>
              </article>
            )}
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>Your commonplace.</h1>
                <p>A little of everything that matters to you.</p>
              </div>
              <span className="flourish" aria-hidden="true">
                ✳
              </span>
            </div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search your book"
                placeholder="Find a thought, a phrase, a possibility…"
                maxLength={500}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="small muted">Search</span>
            </label>
            <div className="section-label">
              <span className="eyebrow">
                {search ? 'FOUND IN YOUR BOOK' : 'RECENTLY COLLECTED'}
              </span>
              <span className="small muted">Newest first</span>
            </div>
            {entries.isPending && <p role="status">Opening your book…</p>}
            {entries.error && (
              <div className="notice error" role="alert">
                <p>{entries.error.message}</p>
                {entries.error instanceof DataError && entries.error.code === 'auth' && (
                  <button onClick={onReauthenticate}>Sign in again</button>
                )}
                <button onClick={() => void entries.refetch()}>Try again</button>
              </div>
            )}
            {!entries.isPending && !entries.error && items.length === 0 && (
              <section className="empty-state">
                <span className="empty-art" aria-hidden="true">
                  ❧
                </span>
                <h2>{search ? 'Nothing here just yet.' : 'Every collection starts somewhere.'}</h2>
                <p>
                  {search
                    ? 'Try a different word or phrase.'
                    : 'A sentence from a book. An idea on your walk.\nGive the first one a home.'}
                </p>
                {!search && (
                  <button className="secondary" onClick={() => setEditor({ entry: null })}>
                    Keep your first entry ↗
                  </button>
                )}
              </section>
            )}
            <div className="entry-list">
              {items.map((entry) => (
                <a
                  className={`entry-card kind-${entry.kind}`}
                  href={`#entry/${entry.id}`}
                  key={entry.id}
                >
                  <div className="entry-meta">
                    <span className="type-label">{entry.kind}</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <h2>{entry.title}</h2>
                  <p>
                    {entry.body.slice(0, 230)}
                    {entry.body.length > 230 ? '…' : ''}
                  </p>
                  <span className="card-arrow" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ))}
            </div>
            {entries.hasNextPage && (
              <button
                className="secondary load-more"
                disabled={entries.isFetchingNextPage}
                onClick={() => void entries.fetchNextPage()}
              >
                {entries.isFetchingNextPage ? 'Loading…' : 'A little further back'}
              </button>
            )}
          </>
        )}
        <footer className="page-footer">There is room for all of it.</footer>
      </main>
      {editor && (
        <Editor
          entry={editor.entry}
          active={active}
          onReauthenticate={onReauthenticate}
          onSaved={onSaved}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
