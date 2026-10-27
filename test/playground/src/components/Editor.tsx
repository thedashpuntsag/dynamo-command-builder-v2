import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { keymap } from '@codemirror/view';

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: '#dce2dc', fontSize: '13px' },
    '.cm-scroller': {
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: '1.85',
      overflow: 'auto',
    },
    '.cm-content': { padding: '20px 0', caretColor: '#b4ed86' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#626c62', border: 'none', padding: '20px 8px 20px 12px' },
    '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: '#b4ed8609' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#385131' },
    '.cm-cursor': { borderLeftColor: '#b4ed86' },
  },
  { dark: true }
);

export function Editor({
  value,
  onChange,
  onRun,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };
  useEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      doc: value,
      parent: container.current,
      extensions: [
        basicSetup,
        javascript(),
        theme,
        EditorView.contentAttributes.of({ 'aria-label': 'Command input JavaScript object', spellcheck: 'false' }),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              callbacks.current.onRun();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
        }),
      ],
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
    // The editor owns its document until a parent requests a replacement.
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);
  return <div className='editor' ref={container} />;
}
