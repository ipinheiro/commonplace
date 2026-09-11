const colors = ['blue', 'teal', 'plum', 'rose', 'gold', 'olive', 'indigo', 'clay'] as const;
const entryColors: Record<string, (typeof colors)[number]> = {
  note: 'blue',
  idea: 'gold',
  quote: 'plum',
  book: 'teal',
  paper: 'indigo',
  code: 'olive',
  pattern: 'rose',
  lyrics: 'clay',
  project: 'teal',
};

export function labelColor(label: string, type: 'tag' | 'entry' = 'tag') {
  const name = label.normalize('NFKC').trim().toLowerCase();
  if (type === 'entry' && Object.hasOwn(entryColors, name)) return entryColors[name];
  let hash = 0;
  for (const character of name) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return colors[hash % colors.length];
}
