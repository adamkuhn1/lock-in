export class TemplateError extends Error {}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderTemplate(tpl: string, values: Record<string, string>): string {
  const missing = [...new Set([...tpl.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((k) => !(k in values)).sort();
  if (missing.length) throw new TemplateError(`missing values for: ${missing.join(', ')}`);
  return tpl.replace(PLACEHOLDER, (_, k: string) => values[k]);
}
