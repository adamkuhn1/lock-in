import { pythonLanguage } from '@codemirror/lang-python';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { Marked } from 'marked';
import { useMemo } from 'react';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Python code blocks get the same colors as the editor (tok-* classes, styled in app.css). */
export function highlightPython(code: string): string {
  let html = '';
  highlightCode(code, pythonLanguage.parser.parse(code), classHighlighter,
    (text, classes) => { html += classes ? `<span class="${classes}">${escape(text)}</span>` : escape(text); },
    () => { html += '\n'; });
  return html;
}

const md = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const body = lang === 'python' ? highlightPython(text) : escape(text);
      return `<pre class="code-block" tabindex="0"><code>${body}</code></pre>`;
    },
  },
});

// Lesson tables are truth tables and place-value charts: let them scroll sideways on their own, never the page.
const wrapTables = (html: string) => html.replace(/<table>/g, '<div class="table-wrap" tabindex="0"><table>').replace(/<\/table>/g, '</table></div>');

/**
 * Lesson prose. The content is first-party (shared/lessons, reviewed in git and built into the app), so its
 * HTML is rendered as written; that's what lets a lesson include an inline SVG diagram.
 */
export function Markdown({ text, className = 'prose' }: { text: string; className?: string }) {
  const html = useMemo(() => wrapTables(md.parse(text, { async: false })), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MarkdownInline({ text }: { text: string }) {
  const html = useMemo(() => md.parseInline(text, { async: false }), [text]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
