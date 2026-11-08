import type { LcRating } from '../data/types';

/** The rating as a mark: filled = solo, half = explanation, ring = code-along, dashed = not tried yet. */
export function RatingMark({ rating, size = 12 }: { rating: LcRating | null; size?: number }) {
  return <span className={`mark mark-${rating ?? 'none'}`} style={{ width: size, height: size }} aria-hidden="true" />;
}
