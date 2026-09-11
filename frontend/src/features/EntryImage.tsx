import { useQuery } from '@tanstack/react-query';
import { imageUrl } from '../data/images';
import type { EntryImage as ImageRecord } from '../domain/entries';

export function EntryImage({ image }: { image: ImageRecord }) {
  const url = useQuery({
    queryKey: ['image-url', image.path],
    queryFn: () => imageUrl(image.path),
    staleTime: 50 * 60 * 1000,
    refetchInterval: 50 * 60 * 1000,
  });
  return (
    <figure className="attached-image">
      {url.data && (
        <a href={url.data} target="_blank" rel="noreferrer">
          <img src={url.data} alt={image.name} loading="lazy" />
        </a>
      )}
      {url.isPending && <p role="status">Loading image…</p>}
      {url.error && (
        <button type="button" className="text-button" onClick={() => void url.refetch()}>
          Retry loading {image.name}
        </button>
      )}
      <figcaption>{image.name}</figcaption>
    </figure>
  );
}
