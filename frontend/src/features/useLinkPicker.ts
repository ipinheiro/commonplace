import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { searchTitles } from '../data/knowledge';
import type { LinkTarget } from '../domain/links';
import type { Space } from '../domain/entries';

type Options = {
  textarea: RefObject<HTMLTextAreaElement | null>;
  space: Space;
  setBody: (body: string) => void;
};

// The picker is open while the caret sits after an unclosed "[[" on the current line.
function openQuery(value: string, caret: number): string | null {
  const before = value.slice(0, caret);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const start = line.lastIndexOf('[[');
  if (start === -1) return null;
  const inner = line.slice(start + 2);
  if (inner.includes(']]')) return null;
  return inner;
}

export function useLinkPicker({ textarea, space, setBody }: Options) {
  const [query, setQuery] = useState<string | null>(null);
  const [options, setOptions] = useState<LinkTarget[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'done'>('idle');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (query === null) {
      setOptions([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('searching');
    const timeout = setTimeout(() => {
      searchTitles(query, space, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setOptions(found);
          setActive(0);
          setStatus('done');
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus('done');
        });
    }, 150);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, space]);

  function sync() {
    const element = textarea.current;
    if (!element) return;
    setQuery(openQuery(element.value, element.selectionStart));
  }

  function choose(option: LinkTarget) {
    const element = textarea.current;
    if (!element) return;
    const caret = element.selectionStart;
    const before = element.value.slice(0, caret);
    const start = before.lastIndexOf('[[');
    const insert = `[[${option.id}|${option.title}]]`;
    const next = before.slice(0, start) + insert + element.value.slice(caret);
    setBody(next);
    setQuery(null);
    const position = start + insert.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(position, position);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if ((event.key === 'Enter' || event.key === 'Tab') && options[active]) {
      event.preventDefault();
      event.stopPropagation();
      choose(options[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
    }
  }

  return { open: query !== null, options, active, status, sync, choose, onKeyDown };
}
