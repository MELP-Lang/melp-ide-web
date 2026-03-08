// CodeMirror 6 editör fabrikası — esbuild ile dist/editor.bundle.js olarak paketlenir

import { EditorState, Compartment }         from '@codemirror/state';
import { EditorView, keymap, lineNumbers,
         highlightActiveLine, drawSelection,
         highlightSpecialChars, dropCursor } from '@codemirror/view';
import { defaultKeymap, history,
         historyKeymap, indentWithTab }      from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap,
         closeBrackets }                     from '@codemirror/autocomplete';
import { lintKeymap, linter, lintGutter }   from '@codemirror/lint';
import { oneDark }                            from '@codemirror/theme-one-dark';
import { indentOnInput, bracketMatching,
         foldGutter, foldKeymap }            from '@codemirror/language';
import { melpLanguageExtension }             from './melp-lang.js';

// ── Renk teması ────────────────────────────────────────────────────────────
const melpTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    background: '#1e1e1e',
  },
  '.cm-content': {
    caretColor: '#aeafad',
    minHeight: '100%',
  },
  '.cm-gutters': {
    background: '#1e1e1e',
    color: '#495162',
    border: 'none',
    borderRight: '1px solid #282c34',
  },
  '.cm-activeLineGutter': { background: '#2c313c' },
  '.cm-activeLine': { background: '#2c313c' },
  '.cm-selectionBackground, ::selection': { background: '#3e4451 !important' },
  '.cm-cursor': { borderLeftColor: '#528bff' },
  '.cm-matchingBracket': { background: '#515a6b', color: '#fff !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: '#21252b',
    border: '1px solid #181a1f',
    color: '#abb2bf',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: '#2c313c',
    color: '#fff',
  },
});

// ── Lint yapılandırması (gelecekte LSP diagnostics bağlanacak) ──────────────
const melpLinter = linter(() => []);    // şimdilik boş; LSP'den doldurulacak
const lintCompartment = new Compartment();

// ── Editör oluştur ─────────────────────────────────────────────────────────
export function createEditor(container, initialContent = '') {
  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      // Görsel
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      highlightSpecialChars(),
      dropCursor(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      lintGutter(),
      // Davranış
      history(),
      indentOnInput(),
      autocompletion(),
      highlightSelectionMatches(),
      // Klavye
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        ...foldKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      // Tema & dil
      oneDark,
      melpTheme,
      ...melpLanguageExtension,
      // Lint (compartment ile sonradan güncellenebilir)
      lintCompartment.of(melpLinter),
      // İçerik değiştiğinde dışarıya bildir
      EditorView.updateListener.of((update) => {
        if (update.docChanged && typeof window.onEditorChange === 'function') {
          window.onEditorChange(update.state.doc.toString());
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent: container });

  return {
    view,

    /** Editörün içeriğini döndürür */
    getValue() {
      return view.state.doc.toString();
    },

    /** Editörün içeriğini değiştirir */
    setValue(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },

    /** Editörü odaklar */
    focus() {
      view.focus();
    },

    /** LSP diagnosticlerini gösterir */
    setDiagnostics(diagnostics) {
      // diagnostics: [{ from, to, severity, message }]
      view.dispatch(
        lintCompartment.reconfigure(linter(() => diagnostics))
      );
    },

    /** Editörü yok eder */
    destroy() {
      view.destroy();
    },
  };
}
