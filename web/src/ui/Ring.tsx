import { useMounted } from './motion';

const R = 42;
const C = 2 * Math.PI * R;

export function Ring({ value, max, label, caption, color }: { value: number; max: number; label: string; caption: string; color: 'orange' | 'yellow' | 'green' | 'cyan' }) {
  const on = useMounted();
  const frac = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <figure className={`ring ring-${color}`} role="img" aria-label={`${label}: ${value} of ${max}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={R} />
        <circle className="ring-fill" cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - (on ? frac : 0))} transform="rotate(-90 50 50)" />
      </svg>
      <figcaption aria-hidden="true"><b className="num">{value}</b><small>{caption}</small></figcaption>
    </figure>
  );
}
