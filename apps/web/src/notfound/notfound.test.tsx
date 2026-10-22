import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotFound } from './NotFound.tsx';

describe('404 page', () => {
  const html = renderToStaticMarkup(<NotFound navigate={() => {}} />);

  it('has exactly one h1', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it('links to the homepage', () => {
    expect(html).toMatch(/<a [^>]*href="\/"/);
  });

  it('puts both animated logo parts inside .signal-lost', () => {
    const start = html.indexOf('class="signal-lost"');
    expect(start).toBeGreaterThanOrEqual(0);
    const box = html.slice(start, html.indexOf('</svg>', start));
    expect(box).toContain('brand-mark-ring');
    expect(box).toContain('brand-mark-inner');
  });

  it('is excluded from search indexing', () => {
    expect(html).toContain('<meta name="robots" content="noindex"/>');
  });
});
