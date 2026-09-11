import { labelColor } from './labelColors';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DataError,
  draftSchema,
  entryContext,
  type Entry,
  type Space,
  type EntryDraft,
  type EntryImage as ImageRecord,
  type SaveEntry,
} from '../domain/entries';
import { getEntry, saveEntry } from '../data/knowledge';
import Markdown from 'react-markdown';
import { EntryContextDetails } from './EntryContextDetails';
import { EntryImage } from './EntryImage';
import { uploadImage, imageTypes, maxImageBytes } from '../data/images';

type Props = {
  entry: Entry | null;
  initialKind?: string;
  initialSpace?: Space;
  availableKinds?: string[];
  onSaved: (entry: Entry) => void;
  onClose: () => void;
  active?: boolean;
  onReauthenticate?: () => void;
};

export function Editor({
  entry,
  initialKind = 'note',
  initialSpace = 'personal',
  availableKinds = [],
  onSaved,
  onClose,
  active = true,
  onReauthenticate,
}: Props) {
  const [draft, setDraft] = useState<EntryDraft>(
    entry
      ? {
          title: entry.title,
          body: entry.body,
          kind: entry.kind,
          context: entryContext(entry.metadata),
        }
      : { title: '', body: '', kind: initialKind, context: entryContext({ space: initialSpace }) },
  );
  const [tagInput, setTagInput] = useState('');
  const [pendingImages, setPendingImages] = useState<{ id: string; file: File; url: string }[]>([]);
  const previewUrls = useRef(new Set<string>());
  const uploadedImages = useRef(new Map<string, ImageRecord>());
  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const [error, setError] = useState<DataError | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
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
    draft.kind !== (entry?.kind ?? initialKind) ||
    tagInput.trim() !== '' ||
    pendingImages.length > 0 ||
    JSON.stringify(draft.context) !==
      JSON.stringify(entryContext(entry?.metadata ?? { space: initialSpace }));

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

  function addTag() {
    const tag = tagInput.trim();
    if (!tag) return;
    if (draft.context.tags.length >= 30 || tag.length > 64) {
      setError(new DataError('invalid', 'Use up to 30 tags, with 64 characters per tag.'));
      return;
    }
    setDraft({
      ...draft,
      context: { ...draft.context, tags: [...new Set([...draft.context.tags, tag])] },
    });
    setTagInput('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = draftSchema.safeParse({
      ...draft,
      context: {
        ...draft.context,
        tags: [...new Set([...draft.context.tags, ...(tagInput.trim() ? [tagInput.trim()] : [])])],
      },
    });
    if (!parsed.success) {
      setError(new DataError('invalid', parsed.error.issues[0].message));
      return;
    }
    setSaving(true);
    try {
      let request = attempt.current;
      if (!request) {
        const images = [...parsed.data.context.images];
        for (const pending of pendingImages) {
          let image = uploadedImages.current.get(pending.id);
          if (!image) {
            image = await uploadImage(entryId.current, pending.id, pending.file);
            uploadedImages.current.set(pending.id, image);
          }
          images.push(image);
        }
        request = {
          entryId: entryId.current,
          expectedVersion: version.current,
          requestId: crypto.randomUUID(),
          draft: { ...parsed.data, context: { ...parsed.data.context, images } },
        };
        attempt.current = request;
      }
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
      <aside className="editor-illustration" aria-hidden="true">
        <img
          src={
            draft.context.space === 'work'
              ? '/illustrations/witchy-work.png'
              : '/illustrations/witchy-commonplace.png'
          }
          alt=""
          width="1254"
          height="1254"
        />
      </aside>
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
                'button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled):not([hidden]), a[href]',
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
            <label htmlFor="entry-space">Space</label>
            <select
              id="entry-space"
              value={draft.context.space}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  context: { ...draft.context, space: event.target.value as Space },
                })
              }
            >
              <option value="personal">Personal</option>
              <option value="work">Work</option>
            </select>
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
                ...new Set([
                  ...availableKinds,
                  'note',
                  'idea',
                  'quote',
                  'memory',
                  'recipe',
                  'book',
                  'paper',
                  'code',
                  'pattern',
                  'lyrics',
                  'project',
                ]),
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
            <label htmlFor="entry-date">
              Entry date <span className="muted">· Optional</span>
            </label>
            <input
              id="entry-date"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              aria-describedby="entry-date-hint"
              value={draft.context.date}
              onChange={(event) =>
                setDraft({ ...draft, context: { ...draft.context, date: event.target.value } })
              }
            />
            <span id="entry-date-hint" className="small muted">
              When you originally wrote this. Leave blank to use the date added to Commonplace.
            </span>
            <label htmlFor="entry-body">
              Your entry <span className="muted">· Markdown welcome</span>
            </label>
            <div className="writing-tools">
              <span className="small muted">
                {draft.body.trim() ? draft.body.trim().split(/\s+/u).length : 0} words
              </span>
              <button
                type="button"
                className="preview-button"
                aria-pressed={preview}
                onClick={() => setPreview(!preview)}
              >
                {preview ? 'Continue writing' : 'Preview'}
              </button>
            </div>
            {preview && (
              <div className="markdown draft-preview" aria-label="Entry preview">
                <Markdown skipHtml>
                  {draft.body || 'Your preview will appear here once you start writing.'}
                </Markdown>
              </div>
            )}
            <textarea
              hidden={preview}
              id="entry-body"
              placeholder="A line you read. A thought you had. Something to come back to…"
              value={draft.body}
              maxLength={1_000_000}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={10}
            />
            <section className="image-fields" aria-labelledby="images-heading">
              <div className="context-heading">
                <h3 id="images-heading">Images</h3>
                <span className="small muted">Optional</span>
              </div>
              <label htmlFor="entry-images">Add images</label>
              <input
                id="entry-images"
                type="file"
                accept={imageTypes.join(',')}
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length + pendingImages.length + draft.context.images.length > 10) {
                    setError(new DataError('invalid', 'Add up to 10 images per entry.'));
                    return;
                  }
                  if (
                    files.some(
                      (file) =>
                        !imageTypes.includes(file.type) ||
                        file.size > maxImageBytes ||
                        file.name.length > 255,
                    )
                  ) {
                    setError(
                      new DataError(
                        'invalid',
                        'Choose JPEG, PNG, WebP, GIF or AVIF images up to 10 MB each.',
                      ),
                    );
                    return;
                  }
                  setPendingImages([
                    ...pendingImages,
                    ...files.map((file) => {
                      const url = URL.createObjectURL(file);
                      previewUrls.current.add(url);
                      return { id: crypto.randomUUID(), file, url };
                    }),
                  ]);
                }}
              />
              <span className="small muted">
                Up to 10 images, 10 MB each. Uploaded when you save.
              </span>
              <div className="image-grid">
                {draft.context.images.map((image) => (
                  <div className="image-tile" key={image.path}>
                    <EntryImage image={image} />
                    <button
                      type="button"
                      className="text-button"
                      aria-label={'Remove image ' + image.name}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          context: {
                            ...draft.context,
                            images: draft.context.images.filter((item) => item.path !== image.path),
                          },
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {pendingImages.map((image) => (
                  <div className="image-tile" key={image.id}>
                    <figure className="attached-image">
                      <img src={image.url} alt={image.file.name} />
                      <figcaption>{image.file.name}</figcaption>
                    </figure>
                    <button
                      type="button"
                      className="text-button"
                      aria-label={'Remove image ' + image.file.name}
                      onClick={() => {
                        setPendingImages(pendingImages.filter((item) => item.id !== image.id));
                        URL.revokeObjectURL(image.url);
                        previewUrls.current.delete(image.url);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className="context-fields" aria-labelledby="context-heading">
              <div className="context-heading">
                <h3 id="context-heading">Tags and source</h3>
                <span className="small muted">Optional</span>
              </div>
              <label htmlFor="entry-tags">Tags</label>
              <div className="tag-input-row">
                <input
                  id="entry-tags"
                  value={tagInput}
                  maxLength={64}
                  placeholder="Add a topic, project, or theme"
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={addTag}
                  disabled={!tagInput.trim() || draft.context.tags.length >= 30}
                >
                  Add tag
                </button>
              </div>
              <span className="small muted">Press Enter to add each tag.</span>
              <div className="entry-tags">
                {draft.context.tags.map((tag) => (
                  <span className="entry-tag" data-color={labelColor(tag)} key={tag}>
                    {tag}
                    <button
                      type="button"
                      aria-label={'Remove tag ' + tag}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          context: {
                            ...draft.context,
                            tags: draft.context.tags.filter((item) => item !== tag),
                          },
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <label htmlFor="entry-url">URL</label>
              <input
                id="entry-url"
                type="url"
                placeholder="https://…"
                maxLength={2048}
                value={draft.context.url}
                onChange={(event) =>
                  setDraft({ ...draft, context: { ...draft.context, url: event.target.value } })
                }
              />
              <label htmlFor="entry-source">Source</label>
              <input
                id="entry-source"
                placeholder="Author, book or article, page number…"
                maxLength={1000}
                value={draft.context.source}
                onChange={(event) =>
                  setDraft({ ...draft, context: { ...draft.context, source: event.target.value } })
                }
              />
            </section>
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
              <EntryContextDetails metadata={latest.metadata} showDate />
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
              {saving ? 'Saving to your book…' : 'Draft in this tab. Save to keep it.'}
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
