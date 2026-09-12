import { ArrowUpRight } from './ArrowUpRight';
import { labelColor } from './labelColors';
import { entryContext } from '../domain/entries';
import { EntryImage } from './EntryImage';

export function EntryContextDetails({
  metadata,
  showDate = false,
}: {
  metadata: Record<string, unknown>;
  showDate?: boolean;
}) {
  const { tags, url, source, images, date } = entryContext(metadata);
  if (!tags.length && !url && !source && !images.length && !(showDate && date)) return null;
  return (
    <section className="entry-context" aria-label="Tags and source">
      {showDate && date && (
        <p>
          Entry date: <time dateTime={date}>{date}</time>
        </p>
      )}
      {images.length > 0 && (
        <div className="image-grid">
          {images.map((image) => (
            <EntryImage key={image.path} image={image} />
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="entry-tags" aria-label="Tags">
          {tags.map((tag) => (
            <span key={tag} className="entry-tag" data-color={labelColor(tag)}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {(source || url) && (
        <div className="source-details">
          <span className="eyebrow">Source</span>
          {source && <p>{source}</p>}
          {url && (
            <a href={url} target="_blank" rel="noreferrer">
              {url} <ArrowUpRight />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
