import { useEffect, useState } from 'react';

function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme
    ? theme === 'dark'
    : Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

export function ThemeToggle() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const sync = () => setDark(isDark());
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      media?.removeEventListener('change', sync);
      observer.disconnect();
    };
  }, []);
  return (
    <button
      className="theme-toggle"
      aria-label={dark ? 'Switch to light' : 'Switch to dark'}
      onClick={() => {
        const next = isDark() ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('dsa-theme', next);
        } catch {
          /* Theme works without storage. */
        }
        setDark(next === 'dark');
      }}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        {dark ? (
          <>
            <circle cx="10" cy="10" r="3.4" />
            <path d="M10 1v2m0 14v2M1 10h2m14 0h2M3 3l2 2m10 10 2 2M3 17l2-2M15 5l2-2" />
          </>
        ) : (
          <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" />
        )}
      </svg>
    </button>
  );
}
