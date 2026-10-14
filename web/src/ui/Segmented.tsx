import { NavLink } from 'react-router';

export function Segmented({ label, items }: { label: string; items: { to: string; label: string; badge?: number; badgeLabel?: string }[] }) {
  return (
    <nav className="segmented" aria-label={label}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} className="seg-link"
          aria-label={it.badge ? `${it.label}, ${it.badge}${it.badgeLabel ? ` ${it.badgeLabel}` : ''}` : undefined}>
          {it.label}{it.badge ? <span className="seg-badge" aria-hidden="true">{it.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}
