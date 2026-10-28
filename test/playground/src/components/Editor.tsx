import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const nightOwlHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: '#c792ea' },
  { tag: [tags.variableName, tags.name, tags.deleted, tags.character], color: '#d6deeb' },
  { tag: [tags.propertyName, tags.labelName], color: '#c792ea' },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: '#82aaff' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#addb67' },
  { tag: tags.separator, color: '#7fdbca' },
  {
    tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.self, tags.namespace],
    color: '#f78c6c',
  },
  { tag: [tags.tagName, tags.heading, tags.bool, tags.null, tags.atom], color: '#addb67' },
  { tag: [tags.attributeName, tags.regexp, tags.link], color: '#7fdbca' },
  { tag: [tags.string, tags.inserted], color: '#ecc48d' },
  { tag: tags.punctuation, color: '#7fdbca' },
  { tag: tags.bracket, color: '#addb67' },
  { tag: [tags.comment, tags.meta], color: '#637777', fontStyle: 'italic' },
  { tag: tags.invalid, color: '#ffffff', backgroundColor: '#ef5350' },
]);

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#011627', color: '#d6deeb', fontSize: '12px' },
    '.cm-scroller': {
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: '1.5',
      overflow: 'auto',
    },
    '.cm-content': { padding: '20px 0', caretColor: '#80a4c2' },
    '.cm-gutters': { backgroundColor: '#011627', color: '#4b6479', border: 'none', padding: '20px 8px 20px 12px' },
    '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: '#0b2942' },
    '.cm-activeLineGutter': { color: '#c5e4fd' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#1d3b53' },
    '.cm-cursor': { borderLeftColor: '#80a4c2' },
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
        syntaxHighlighting(nightOwlHighlight),
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
