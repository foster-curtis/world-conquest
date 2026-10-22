// The logo and the pieces that carry it on the start screens: home link, loading splash, footer.
// Files live in public/brand and are precached (vite.config includeAssets), so they work offline.

/**
 * The four-cell mark. Below 32px it uses the square-cell variant, which stays crisp at small sizes,
 * unless `angled` asks for the real logo anyway.
 */
export function Mark(props: { size: number; angled?: boolean }) {
  const src = props.size < 32 && !props.angled ? '/brand/mark-small.svg' : '/brand/mark.svg';
  return <img className="mark" src={src} width={props.size} height={props.size} alt="" />;
}

/** Home button for screen headers and the game top bar: the mark is its icon. */
export function HomeLink(props: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="nav-button" onClick={props.onClick}>
      <Mark size={24} angled />
      <span className="nav-label">{props.label ?? 'Home'}</span>
    </button>
  );
}

/** Back button (replay, stats): same shape as HomeLink, with a chevron. */
export function BackButton(props: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="nav-button" onClick={props.onClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="nav-label">{props.label ?? 'Back'}</span>
    </button>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <Mark size={48} />
      <span>Loading…</span>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <Mark size={20} />
      <span>World Conquest</span>
      <span aria-hidden="true">·</span>
      <span>© 2026 Foster Curtis</span>
      <span aria-hidden="true">·</span>
      <a href="https://fostercurtis.dev">fostercurtis.dev</a>
    </footer>
  );
}
