import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

// Colors from tokens.css; every one passes 4.5:1 on --surface (#141414).
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: '#ff8a65' },
  { tag: [t.string, t.special(t.string)], color: '#9be38f' },
  { tag: [t.number, t.bool, t.null], color: '#ffd21a' },
  { tag: [t.comment], color: '#a3a3a3', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.definition(t.variableName))], color: '#7fdcff' },
  { tag: [t.className, t.definition(t.className)], color: '#ffd21a' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '0.92rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
  '.cm-content': { fontFamily: 'var(--mono)', caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: '#8a8a8a', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgb(255 255 255 / 0.04)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(255 77 26 / 0.3) !important' },
  '.cm-matchingBracket': { backgroundColor: 'rgb(255 255 255 / 0.12)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)' },
}, { dark: true });

/**
 * A Python editor. Tab indents; press Escape then Tab to move focus out (CodeMirror's standard escape hatch).
 * `value` only sets the starting text and replaces it when `resetKey` changes (Reset, Show solution).
 */
export function CodeEditor({ value, resetKey, onChange, onRun, label }: {
  value: string; resetKey: number; onChange: (code: string) => void; onRun: () => void; label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onRun });
  handlers.current = { onChange, onRun };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([{ key: 'Mod-Enter', run: () => { handlers.current.onRun(); return true; } }, indentWithTab]),
          basicSetup, python(), indentUnit.of('    '), theme, syntaxHighlighting(highlight),
          EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': label, 'aria-keyshortcuts': 'Meta+Enter Control+Enter' }),
          EditorView.updateListener.of((u) => { if (u.docChanged) handlers.current.onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // The editor owns its text after mount; resetKey is how the parent replaces it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, label]);

  return <div ref={host} className="code-editor" />;
}
