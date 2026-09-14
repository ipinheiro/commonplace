import { z } from 'zod';

export const linkTargetSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  kind: z.string().min(1),
});
export type LinkTarget = z.infer<typeof linkTargetSchema>;

export const connectionsSchema = z
  .object({
    links: z.array(linkTargetSchema),
    backlinks: z.array(linkTargetSchema.extend({ entry_date: z.iso.date() })),
    ghosts: z.array(z.string()),
  })
  .transform((value) => ({
    links: value.links,
    backlinks: value.backlinks.map(({ entry_date, ...rest }) => ({
      ...rest,
      entryDate: entry_date,
    })),
    ghosts: value.ghosts,
  }));
export type Connections = z.infer<typeof connectionsSchema>;
export const emptyConnections: Connections = { links: [], backlinks: [], ghosts: [] };

// Code spans and fences are matched first so the links inside them pass through unchanged.
const tokenPattern = /(```[^`]*```|`[^`]*`)|\[\[([^\]\n]+)\]\]/g;
const idPattern =
  /^\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*(?:\|(.*))?$/i;

function normalise(title: string): string {
  return title.trim().toLowerCase();
}

// Markdown-significant characters are escaped so a title or label can never hijack the
// link destination or be read as emphasis; encodeURIComponent leaves ( and ) unescaped,
// which would otherwise end a Markdown destination early, so those are escaped too.
function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]*_`]/g, (char) => `\\${char}`);
}

function encodeGhostTitle(title: string): string {
  return encodeURIComponent(title).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

type ParsedLink = { id: string | null; label: string };

function parseLink(inner: string): ParsedLink | null {
  const id = idPattern.exec(inner);
  if (id) return { id: id[1].toLowerCase(), label: id[2]?.trim() || id[1] };
  if (!inner.trim()) return null;
  return { id: null, label: inner.trim() };
}

function replaceLinks(body: string, render: (link: ParsedLink) => string): string {
  return body.replace(
    tokenPattern,
    (match, code: string | undefined, inner: string | undefined) => {
      if (code !== undefined || inner === undefined) return match;
      const link = parseLink(inner);
      return link ? render(link) : match;
    },
  );
}

export function linksToMarkdown(body: string, links: LinkTarget[]): string {
  const byId = new Map(links.map((link) => [link.id.toLowerCase(), link]));
  const byTitle = new Map(links.map((link) => [normalise(link.title), link]));
  return replaceLinks(body, ({ id, label }) => {
    const resolved = id ? byId.get(id) : byTitle.get(normalise(label));
    if (resolved) return `[${escapeLinkText(resolved.title)}](#entry/${resolved.id})`;
    return `[${escapeLinkText(label)}](#ghost/${encodeGhostTitle(label)})`;
  });
}

// For plain-text excerpts such as the library cards, where a link is just its label.
export function linksToText(body: string): string {
  return replaceLinks(body, ({ label }) => label);
}

export function ghostTitle(href: string): string | null {
  if (!href.startsWith('#ghost/')) return null;
  try {
    return decodeURIComponent(href.slice('#ghost/'.length));
  } catch {
    return null;
  }
}
