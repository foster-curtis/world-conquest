// The 404 page: any path that isn't home or a game URL (route.ts). The mark plays the "signal lost" glitch.
import type { MouseEvent } from 'react';
import '@fontsource/jetbrains-mono/latin-700.css';
import './notfound.css';

/**
 * mark.svg inlined so its parts can move separately: the tile and gray cells are the ring, the amber cell is the
 * inner part. Each translates by a share of its own box, so the amber cell slips against the rest during a glitch.
 */
function GlitchMark() {
  return (
    <svg className="not-found-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g className="brand-mark-ring">
        <rect className="mark-tile" width="32" height="32" rx="7" />
        <path className="mark-cell" d="M6 6H15L13 15H6Z" />
        <path className="mark-cell" d="M6 17H13L16 26H6Z" />
        <path className="mark-cell" d="M15 17L26 15V26H18Z" />
      </g>
      <path className="brand-mark-inner mark-amber" d="M17 6H26V13L15 15Z" />
    </svg>
  );
}

export function NotFound(props: { navigate: (path: string) => void }) {
  const home = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    props.navigate('/');
  };
  return (
    <div className="not-found">
      {/* React hoists this into <head>. The tab title ("Page not found") is set by App through useMyGames. */}
      <meta name="robots" content="noindex" />
      <header className="not-found-head">
        <div className="signal-lost">
          <GlitchMark />
        </div>
        <div className="not-found-text">
          <p className="not-found-eyebrow">404</p>
          <h1>Signal lost</h1>
          <p className="not-found-lede">That page doesn’t exist, or it moved. Head back to somewhere that does.</p>
          <div className="not-found-actions">
            <a href="/" className="btn btn-primary" onClick={home}>
              Back to the homepage
            </a>
            <a href="https://fostercurtis.dev/contact" className="btn btn-secondary">
              Send a message
            </a>
          </div>
        </div>
      </header>
    </div>
  );
}
