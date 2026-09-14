import { describe, expect, it } from 'vitest';
import { ghostTitle, linksToMarkdown } from './links';

const scarf = { id: '11111111-1111-4111-8111-111111111111', title: 'Winter scarf', kind: 'note' };

describe('linksToMarkdown', () => {
  it('renders a resolved ID link with the current title', () => {
    expect(linksToMarkdown(`See [[${scarf.id}|old label]].`, [scarf])).toBe(
      `See [Winter scarf](#entry/${scarf.id}).`,
    );
  });

  it('renders a resolved title link, ignoring case and spacing', () => {
    expect(linksToMarkdown('See [[ winter SCARF ]].', [scarf])).toBe(
      `See [Winter scarf](#entry/${scarf.id}).`,
    );
  });

  it('renders unresolved links as ghosts using the label or the title', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    expect(linksToMarkdown(`[[${other}|Lost note]] and [[Moss stitch]]`, [])).toBe(
      '[Lost note](#ghost/Lost%20note) and [Moss stitch](#ghost/Moss%20stitch)',
    );
  });

  it('shows the bare ID for an unresolved ID link without a label', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    expect(linksToMarkdown(`[[${other}]]`, [])).toBe(`[${other}](#ghost/${other})`);
  });

  it('leaves links inside fenced and inline code untouched', () => {
    const body = 'Use `[[not a link]]` here.\n```\n[[also not]]\n```\n[[Moss stitch]]';
    expect(linksToMarkdown(body, [])).toBe(
      'Use `[[not a link]]` here.\n```\n[[also not]]\n```\n[Moss stitch](#ghost/Moss%20stitch)',
    );
  });

  it('ignores empty brackets', () => {
    expect(linksToMarkdown('[[]] and [[  ]] stay', [])).toBe('[[]] and [[  ]] stay');
  });

  it('escapes a resolved title so it cannot hijack the link destination', () => {
    const evil = { ...scarf, title: 'pwn](https://evil.test)' };
    expect(linksToMarkdown(`See [[${evil.id}|old label]].`, [evil])).toBe(
      `See [pwn\\](https://evil.test)](#entry/${evil.id}).`,
    );
  });

  it('escapes emphasis markers in a resolved title', () => {
    const emphatic = { ...scarf, title: '*loud* note' };
    expect(linksToMarkdown(`See [[${emphatic.id}]].`, [emphatic])).toBe(
      `See [\\*loud\\* note](#entry/${emphatic.id}).`,
    );
  });

  it('escapes emphasis markers in a ghost label too', () => {
    expect(linksToMarkdown('[[*pwn* note]]', [])).toBe('[\\*pwn\\* note](#ghost/*pwn*%20note)');
  });

  it('keeps parentheses in a ghost destination valid', () => {
    expect(linksToMarkdown('[[Smiley :)]]', [])).toBe('[Smiley :)](#ghost/Smiley%20%3A%29)');
  });
});

describe('ghostTitle', () => {
  it('decodes ghost hrefs and rejects others', () => {
    expect(ghostTitle('#ghost/Moss%20stitch')).toBe('Moss stitch');
    expect(ghostTitle('#entry/11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(ghostTitle('https://example.test')).toBeNull();
  });

  it('round-trips a title containing parentheses', () => {
    expect(ghostTitle('#ghost/Smiley%20%3A%29')).toBe('Smiley :)');
  });
});
