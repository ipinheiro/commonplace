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
});

describe('ghostTitle', () => {
  it('decodes ghost hrefs and rejects others', () => {
    expect(ghostTitle('#ghost/Moss%20stitch')).toBe('Moss stitch');
    expect(ghostTitle('#entry/11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(ghostTitle('https://example.test')).toBeNull();
  });
});
