export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function isJobUrl(s: string): boolean {
  const href = safeHref(s);
  if (!href) return false;
  return new URL(href).hostname.includes('.');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
