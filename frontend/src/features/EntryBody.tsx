import { useMemo, useRef } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { ghostTitle, linksToMarkdown, type LinkTarget } from '../domain/links';

type Props = {
  body: string;
  links?: LinkTarget[];
  onGhost?: (title: string) => void;
  className?: string;
};

export function EntryBody({ body, links = [], onGhost, className = 'markdown' }: Props) {
  const onGhostRef = useRef(onGhost);
  onGhostRef.current = onGhost;
  // A stable component identity keeps React from remounting rendered links on every
  // re-render; recreating this inline each render would tear down and rebuild the DOM.
  const components = useMemo<Components>(
    () => ({
      a: ({ href = '', children }) => {
        const ghost = ghostTitle(href);
        if (ghost === null) return <a href={href}>{children}</a>;
        if (!onGhostRef.current) return <span className="ghost-link">{children}</span>;
        return (
          <button type="button" className="ghost-link" onClick={() => onGhostRef.current?.(ghost)}>
            {children}
          </button>
        );
      },
    }),
    [],
  );
  return (
    <div className={className}>
      <Markdown skipHtml components={components}>
        {linksToMarkdown(body, links)}
      </Markdown>
    </div>
  );
}
