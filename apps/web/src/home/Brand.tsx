// The logo and the pieces that carry it on the start screens: home link, loading splash, footer.
// Files live in public/brand and are precached (vite.config includeAssets), so they work offline.

/** The four-cell mark. Below 32px it uses the square-cell variant, which stays crisp at small sizes. */
export function Mark(props: { size: number }) {
  const src = props.size < 32 ? '/brand/mark-small.svg' : '/brand/mark.svg';
  return <img className="mark" src={src} width={props.size} height={props.size} alt="" />;
}

/** Replaces "← Home" in screen headers: the mark plus a label, so it still reads as navigation. */
export function HomeLink(props: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="ghost home-link" onClick={props.onClick}>
      <Mark size={24} />
      {props.label ?? 'Home'}
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
