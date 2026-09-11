import { labelColor } from './labelColors';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import type { Viewer } from '../data/auth';
import { getEntry, listEntries, listEntryKinds } from '../data/knowledge';
import { DataError, entryDate, type Entry, type EntryCursor } from '../domain/entries';
import { Editor } from './Editor';
import { ThemeToggle } from './ThemeToggle';
import { EntryContextDetails } from './EntryContextDetails';

function currentEntry(): string | null {
  const match = /^#entry\/([a-f0-9-]{36})$/.exec(window.location.hash);
  return match?.[1] ?? null;
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(value.length === 10 ? { timeZone: 'UTC' } : {}),
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
  const [kind, setKind] = useState<string | null>(null);
  const [selected, setSelected] = useState(currentEntry);
  const [editor, setEditor] = useState<{ entry: Entry | null; kind?: string } | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  useEffect(() => {
    if (!savedMessage) return;
    const timeout = setTimeout(() => setSavedMessage(''), 4000);
    return () => clearTimeout(timeout);
  }, [savedMessage]);
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
  const types = useQuery({
    queryKey: ['entry-types', viewer.id],
    enabled: active,
    queryFn: ({ signal }) => listEntryKinds(signal),
  });
  function selectKind(next: string | null) {
    setKind(next);
    setSelected(null);
    window.location.hash = '';
  }
  const entries = useInfiniteQuery({
    queryKey: ['entries', viewer.id, search, kind],
    enabled: active,
    initialPageParam: null as EntryCursor | null,
    queryFn: ({ pageParam, signal }) => listEntries(search, pageParam, signal, kind),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const detail = useQuery({
    queryKey: ['entry', viewer.id, selected],
    enabled: active && Boolean(selected),
    queryFn: ({ signal }) => getEntry(selected!, signal),
  });
  function onSaved(entry: Entry) {
    setEditor(null);
    setSavedMessage('Entry saved.');
    if (kind !== null) setKind(entry.kind);
    client.setQueryData<string[]>(['entry-types', viewer.id], (previous = []) =>
      [...new Set([...previous, entry.kind])].sort((a, b) => a.localeCompare(b)),
    );
    void client.invalidateQueries({ queryKey: ['entry-types', viewer.id] });
    client.setQueryData(['entry', viewer.id, entry.id], entry);
    void client.invalidateQueries({ queryKey: ['entries', viewer.id] });
    window.location.hash = `entry/${entry.id}`;
  }
  const items = entries.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="book-layout">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="mini-mark">c.</span> commonplace
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
        {Boolean(types.data?.length) && (
          <nav className="capture-types" aria-label="Create an entry by type">
            <span className="eyebrow">Quick capture</span>
            {types.data?.map((entryKind) => (
              <button
                key={entryKind}
                className="capture-type"
                data-color={labelColor(entryKind, 'entry')}
                aria-label={`New ${entryKind}`}
                onClick={() => setEditor({ entry: null, kind: entryKind })}
              >
                <span className="capture-type-dot" aria-hidden="true" />
                <span>{entryKind.charAt(0).toLocaleUpperCase() + entryKind.slice(1)}</span>
                <span className="capture-type-plus" aria-hidden="true">
                  +
                </span>
              </button>
            ))}
          </nav>
        )}
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
          <span className="eyebrow">Astra inclinant sed non obligant</span>
          <div className="top-right">
            <span className="private-label">
              <span aria-hidden="true">◌</span> Private
            </span>
            <ThemeToggle />
          </div>
        </header>
        <nav className="entry-type-tabs" aria-label="Entry types">
          {[null, ...new Set([...(types.data ?? []), ...(kind ? [kind] : [])])].map((entryKind) => (
            <button
              key={entryKind ?? '__all'}
              className="entry-type-tab"
              data-color={entryKind === null ? undefined : labelColor(entryKind, 'entry')}
              aria-pressed={kind === entryKind}
              onClick={() => selectKind(entryKind)}
            >
              {entryKind === null
                ? 'All entries'
                : entryKind.charAt(0).toLocaleUpperCase() + entryKind.slice(1)}
            </button>
          ))}
          {types.isPending && (
            <span className="small muted" role="status">
              Loading types…
            </span>
          )}
          {types.error && (
            <button className="text-button" onClick={() => void types.refetch()}>
              Retry loading types
            </button>
          )}
        </nav>
        {savedMessage && (
          <p className="save-status" role="status">
            {savedMessage}
          </p>
        )}
        <div className={selected ? 'workspace has-selection' : 'workspace'}>
          <section className="library" aria-label="Your entries">
            <div className="page-heading">
              <div>
                <h1>Your commonplace.</h1>
                <p>A little of everything that matters to you.</p>
              </div>
            </div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search your book"
                placeholder="Search titles and entries…"
                maxLength={500}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="clear-search"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    setSearch('');
                  }}
                >
                  ×
                </button>
              )}
            </label>
            <div className="section-label">
              <span className="eyebrow">{search ? 'FOUND IN YOUR BOOK' : 'YOUR ENTRIES'}</span>
              <span className="small muted">By entry date · Newest first</span>
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
                <h2>
                  {search || kind ? 'No matching entries.' : 'Every collection starts somewhere.'}
                </h2>
                <p>
                  {search || kind
                    ? 'Try another search or entry type.'
                    : 'A sentence from a book. An idea on your walk.\nGive the first one a home.'}
                </p>
                {!search && !kind && (
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
                  aria-current={selected === entry.id ? 'true' : undefined}
                  href={`#entry/${entry.id}`}
                  key={entry.id}
                >
                  <div className="entry-meta">
                    <span className="type-label" data-color={labelColor(entry.kind, 'entry')}>
                      {entry.kind}
                    </span>
                    <time dateTime={entryDate(entry)}>{formatDate(entryDate(entry))}</time>
                  </div>
                  <h2 className="entry-title">{entry.title}</h2>
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
          </section>
          <section className="reader" aria-label="Entry reader">
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
                      <span
                        className="type-label"
                        data-color={labelColor(detail.data.kind, 'entry')}
                      >
                        {detail.data.kind}
                      </span>
                      <time dateTime={entryDate(detail.data)}>
                        {formatDate(entryDate(detail.data))}
                      </time>
                    </div>
                    <h1>{detail.data.title}</h1>
                    <div className="markdown">
                      <Markdown skipHtml>{detail.data.body}</Markdown>
                    </div>
                    <EntryContextDetails metadata={detail.data.metadata} />
                    <footer className="entry-footer">
                      <span className="muted small">
                        Added {formatDate(detail.data.createdAt)} · Updated{' '}
                        {formatDate(detail.data.updatedAt)}
                      </span>
                      <button
                        className="secondary"
                        onClick={() => setEditor({ entry: detail.data! })}
                      >
                        Edit entry
                      </button>
                    </footer>
                  </article>
                )}
              </>
            ) : (
              <div className="reader-empty">
                <span className="eyebrow">A collection of your own</span>
                <img
                  className="collection-illustration"
                  src="/illustrations/witchy-commonplace.png"
                  alt="A sleeping black cat curled around an open notebook, with herbs and a golden crescent moon."
                  width="1254"
                  height="1254"
                />
                <h2 className="display">
                  Keep a thought.
                  <br />
                  Make room for the next.
                </h2>
                <p>
                  Choose an entry to revisit, or capture
                  <br />
                  something you want to remember.
                </p>
                <button className="secondary" onClick={() => setEditor({ entry: null })}>
                  Write an entry <span aria-hidden="true">↗</span>
                </button>
                <span className="small muted">
                  Press <kbd>N</kbd> to start writing
                </span>
              </div>
            )}
          </section>
        </div>
      </main>
      {editor && (
        <Editor
          entry={editor.entry}
          initialKind={editor.kind}
          availableKinds={types.data}
          active={active}
          onReauthenticate={onReauthenticate}
          onSaved={onSaved}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
