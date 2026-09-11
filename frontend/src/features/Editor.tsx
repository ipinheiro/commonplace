import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DataError,
  draftSchema,
  type Entry,
  type EntryDraft,
  type SaveEntry,
} from '../domain/entries';
import { getEntry, saveEntry } from '../data/knowledge';

type Props = {
  entry: Entry | null;
  onSaved: (entry: Entry) => void;
  onClose: () => void;
  active?: boolean;
  onReauthenticate?: () => void;
};

export function Editor({ entry, onSaved, onClose, active = true, onReauthenticate }: Props) {
  const [draft, setDraft] = useState<EntryDraft>(
    entry
      ? {
          title: entry.title,
          body: entry.body,
          kind: entry.kind,
        }
      : { title: '', body: '', kind: 'note' },
  );
  const [error, setError] = useState<DataError | null>(null);
  const [saving, setSaving] = useState(false);
  const [latest, setLatest] = useState<Entry | null>(null);
  const [checking, setChecking] = useState(false);
  const modal = useRef<HTMLElement | null>(null);
  const attempt = useRef<SaveEntry | null>(null);
  const entryId = useRef(entry?.id ?? crypto.randomUUID());
  const version = useRef(entry?.version ?? null);
  const uncertain = error?.code === 'unavailable' || error?.code === 'auth';
  const dirty =
    draft.title !== (entry?.title ?? '') ||
    draft.body !== (entry?.body ?? '') ||
    draft.kind !== (entry?.kind ?? 'note');

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty || uncertain) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, uncertain]);

  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previousFocus = document.activeElement;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [active]);

  function close() {
    if (
      !saving &&
      (!(dirty || uncertain) ||
        window.confirm(
          'Discard this draft? An interrupted save may already have reached your book.',
        ))
    )
      onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = draftSchema.safeParse(draft);
    if (!parsed.success) {
      setError(new DataError('invalid', parsed.error.issues[0].message));
      return;
    }
    setSaving(true);
    const request = attempt.current ?? {
      entryId: entryId.current,
      expectedVersion: version.current,
      requestId: crypto.randomUUID(),
      draft: parsed.data,
    };
    attempt.current = request;
    try {
      const saved = await saveEntry(request);
      onSaved(saved);
    } catch (caught) {
      const failure =
        caught instanceof DataError
          ? caught
          : new DataError(
              'unavailable',
              'The save could not be confirmed. Retry to check it safely.',
            );
      setError(failure);
      if (failure.code === 'invalid' || failure.code === 'conflict') attempt.current = null;
    } finally {
      setSaving(false);
    }
  }

  async function compare() {
    setChecking(true);
    try {
      setLatest(await getEntry(entryId.current));
    } catch (caught) {
      setError(
        caught instanceof DataError
          ? caught
          : new DataError('unavailable', 'Could not load the latest entry.'),
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        ref={modal}
        className="editor modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-heading"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key === 'Tab') {
            const controls = Array.from(
              modal.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]',
              ) ?? [],
            ).filter((element) => !element.closest('fieldset:disabled'));
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-top">
          <span className="eyebrow">A PLACE TO KEEP IT</span>
          <button
            className="icon-button"
            onClick={close}
            disabled={saving}
            aria-label="Close editor"
          >
            ×
          </button>
        </div>
        <h2 id="editor-heading">{entry ? 'Return to a thought.' : 'Something worth keeping.'}</h2>
        <form onSubmit={submit}>
          <fieldset disabled={saving || uncertain}>
            <label htmlFor="entry-kind">Entry type</label>
            <input
              id="entry-kind"
              list="entry-kinds"
              maxLength={64}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            />
            <datalist id="entry-kinds">
              {[
                'note',
                'idea',
                'quote',
                'book',
                'paper',
                'code',
                'pattern',
                'lyrics',
                'project',
              ].map((kind) => (
                <option key={kind} value={kind} />
              ))}
            </datalist>
            <label htmlFor="entry-title">Title</label>
            <input
              id="entry-title"
              className="title-input"
              placeholder="Give this thought a name"
              autoFocus
              required
              maxLength={300}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <label htmlFor="entry-body">
              Your entry <span className="muted">· Markdown welcome</span>
            </label>
            <textarea
              id="entry-body"
              placeholder="A line you read. A thought you had. Something to come back to…"
              value={draft.body}
              maxLength={1_000_000}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={10}
            />
          </fieldset>
          {error && (
            <div className="notice error" role="alert">
              <p>{error.message}</p>
              {uncertain && <p>Retry the same save before making more changes.</p>}
              {error.code === 'auth' && onReauthenticate && (
                <button type="button" className="text-button" onClick={onReauthenticate}>
                  Sign in again
                </button>
              )}
              {error.code === 'conflict' && (
                <button type="button" className="text-button" disabled={checking} onClick={compare}>
                  {checking ? 'Loading…' : 'Compare with the latest version'}
                </button>
              )}
            </div>
          )}
          {latest && (
            <div className="notice comparison">
              <h3>Latest saved version</h3>
              <strong>{latest.title}</strong>
              <pre>{latest.body}</pre>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  version.current = latest.version;
                  attempt.current = null;
                  setLatest(null);
                  setError(null);
                }}
              >
                Keep my draft and save against this version
              </button>
            </div>
          )}
          <div className="editor-footer">
            <span className="muted">
              {saving ? 'Saving to your book…' : 'Only saved when your book confirms it.'}
            </span>
            <button className="primary" disabled={saving || error?.code === 'conflict'}>
              {saving ? 'Saving…' : uncertain ? 'Retry save' : 'Save entry'}{' '}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
