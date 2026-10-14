const MAX = 120;

/** One readable line for an error from the worker or the Mac launcher; the full text goes behind a Disclosure. */
export function shortError(e: string): string {
  const first = e.trim().split('\n')[0].trim();
  return first.length > MAX ? `${first.slice(0, MAX - 1)}…` : first;
}
