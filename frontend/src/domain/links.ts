import { z } from 'zod';

export const linkTargetSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  kind: z.string().min(1),
});
export type LinkTarget = z.infer<typeof linkTargetSchema>;

export const connectionsSchema = z
  .object({
    links: z.array(linkTargetSchema),
    backlinks: z.array(linkTargetSchema.extend({ entry_date: z.string().date() })),
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

export function linksToMarkdown(body: string, links: LinkTarget[]): string {
  const byId = new Map(links.map((link) => [link.id.toLowerCase(), link]));
  const byTitle = new Map(links.map((link) => [normalise(link.title), link]));
  return body.replace(
    tokenPattern,
    (match, code: string | undefined, inner: string | undefined) => {
      if (code !== undefined || inner === undefined) return match;
      const id = idPattern.exec(inner);
      let label: string;
      let resolved: LinkTarget | undefined;
      if (id) {
        resolved = byId.get(id[1].toLowerCase());
        label = id[2]?.trim() || id[1];
      } else {
        if (!inner.trim()) return match;
        resolved = byTitle.get(normalise(inner));
        label = inner.trim();
      }
      if (resolved) return `[${resolved.title}](#entry/${resolved.id})`;
      return `[${label}](#ghost/${encodeURIComponent(label)})`;
    },
  );
}

export function ghostTitle(href: string): string | null {
  if (!href.startsWith('#ghost/')) return null;
  try {
    return decodeURIComponent(href.slice('#ghost/'.length));
  } catch {
    return null;
  }
}
