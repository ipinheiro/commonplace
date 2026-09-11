import { labelColor } from './labelColors';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import type { Viewer } from '../data/auth';
import { getEntry, listEntries, listEntryKinds } from '../data/knowledge';
import {
  DataError,
  entryDate,
  entrySpace,
  type Space,
  type Entry,
  type EntryCursor,
} from '../domain/entries';
import { Editor } from './Editor';
import { ThemeToggle } from './ThemeToggle';
import { EntryContextDetails } from './EntryContextDetails';

function currentEntry(): string | null {
  const match = /^#entry\/([a-f0-9-]{36})$/.exec(window.location.hash);
  return match?.[1] ?? null;
}
function currentSpace(): Space | null {
  if (window.location.hash === '#work') return 'work';
  if (window.location.hash === '#personal' || currentEntry()) return 'personal';
  return null;
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
  const [space, setSpace] = useState<Space | null>(currentSpace);
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
    const onHash = () => {
      if (editor) return;
      const entry = currentEntry();
      setSelected(entry);
      if (!entry) {
        const next = currentSpace();
        setSpace(next);
        if (next !== space) {
          setKind(null);
          setQuery('');
          setSearch('');
        }
      }
    };
    window.addEventListener('hashchange', onHash);
    // Apply navigation deferred while the editor was preserving an open draft.
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, [editor, space]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        !active ||
        !space ||
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
  }, [active, editor, space]);
  const types = useQuery({
    queryKey: ['entry-types', viewer.id, space],
    enabled: active && Boolean(space),
    queryFn: ({ signal }) => listEntryKinds(signal, space!),
  });
  function selectKind(next: string | null) {
    setKind(next);
    setSelected(null);
    window.location.hash = space ?? '';
  }
  const entries = useInfiniteQuery({
    queryKey: ['entries', viewer.id, space, search, kind],
    enabled: active && Boolean(space),
    initialPageParam: null as EntryCursor | null,
    queryFn: ({ pageParam, signal }) => listEntries(search, pageParam, signal, kind, space!),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const detail = useQuery({
    queryKey: ['entry', viewer.id, selected],
    enabled: active && Boolean(selected),
    queryFn: ({ signal }) => getEntry(selected!, signal),
  });
  useEffect(() => {
    if (selected && detail.data) setSpace(entrySpace(detail.data));
  }, [selected, detail.data]);
  function onSaved(entry: Entry) {
    setEditor(null);
    setSavedMessage('Entry saved.');
    const savedSpace = entrySpace(entry);
    setSpace(savedSpace);
    setSelected(entry.id);
    if (savedSpace !== space) {
      setKind(null);
      setQuery('');
      setSearch('');
    } else if (kind !== null) setKind(entry.kind);
    client.setQueryData<string[]>(['entry-types', viewer.id, savedSpace], (previous = []) =>
      [...new Set([...previous, entry.kind])].sort((a, b) => a.localeCompare(b)),
    );
    void client.invalidateQueries({ queryKey: ['entry-types', viewer.id] });
    client.setQueryData(['entry', viewer.id, entry.id], entry);
    void client.invalidateQueries({ queryKey: ['entries', viewer.id] });
    window.location.hash = `entry/${entry.id}`;
  }
  const items = entries.data?.pages.flatMap((page) => page.items) ?? [];
  if (!space)
    return (
      <main className="space-welcome">
        <header className="page-top">
          <span className="brand">
            <span className="mini-mark">c.</span> commonplace
          </span>
          <ThemeToggle />
        </header>
        <div className="space-introduction">
          <span className="eyebrow">A book of your own</span>
          <h1>A little room for every part of your life.</h1>
          <p>Welcome back. Where would you like to begin?</p>
        </div>
        <nav className="space-cards" aria-label="Your spaces">
          <a href="#personal" className="space-card" data-space="personal">
            <span className="eyebrow">01 / Your everyday</span>
            <h2>Personal</h2>
            <p>Thoughts, discoveries and things worth keeping.</p>
            <span className="space-open">
              Open Personal <span aria-hidden="true">↗</span>
            </span>
          </a>
          <a href="#work" className="space-card" data-space="work">
            <span className="eyebrow">02 / Your working life</span>
            <h2>Work</h2>
            <p>Notes, ideas and things to come back to at work.</p>
            <span className="space-open">
              Open Work <span aria-hidden="true">↗</span>
            </span>
          </a>
        </nav>
        <footer className="space-welcome-footer">
          <p className="small muted">Both spaces are private to you.</p>
          <span className="small">{viewer.email}</span>
          <button className="text-button" onClick={onSignOut}>
            Sign out
          </button>
        </footer>
      </main>
    );
  return (
    <div className="book-layout" data-space={space}>
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="mini-mark">c.</span> commonplace
        </a>
        <p className="sidebar-note">
          A collection of things
          <br />
          worth keeping.
        </p>
        <nav className="space-switcher" aria-label="Your spaces">
          <a href="#personal" aria-current={space === 'personal' ? 'page' : undefined}>
            Personal
          </a>
          <a href="#work" aria-current={space === 'work' ? 'page' : undefined}>
            Work
          </a>
        </nav>
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
                <h1>{space === 'work' ? 'Your work commonplace.' : 'Your commonplace.'}</h1>
                <p>
                  {space === 'work'
                    ? 'A place for your working thoughts.'
                    : 'A little of everything that matters to you.'}
                </p>
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
                <a href={`#${space}`} className="back-link">
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
                  src={
                    space === 'work'
                      ? '/illustrations/witchy-work.png'
                      : '/illustrations/witchy-commonplace.png'
                  }
                  alt={
                    space === 'work'
                      ? 'A sleeping black cat beside a laptop and planner, framed by sage, lavender and a golden crescent moon.'
                      : 'A sleeping black cat curled around an open notebook, with herbs and a golden crescent moon.'
                  }
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
          initialSpace={space}
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
