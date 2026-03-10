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
         foldGutter, foldKeymap,
         syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { melpLanguageExtension,
         melpCompletionSource }              from './melp-lang.js';

// ── Renk teması ────────────────────────────────────────────────────────────
const melpTheme = EditorView.theme({
  '&': {
    height: '100%',
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
  // ── Arama paneli ──────────────────────────────────────────────────────
  '.cm-panel': {
    background: '#21252b',
    borderTop: '1px solid #181a1f',
    color: '#abb2bf',
    padding: '6px 10px',
  },
  '.cm-panel input': {
    background: '#1e1e1e',
    border: '1px solid #3e4451',
    borderRadius: '3px',
    color: '#abb2bf',
    padding: '2px 6px',
    outline: 'none',
    marginRight: '4px',
  },
  '.cm-panel input:focus': {
    borderColor: '#528bff',
  },
  '.cm-panel button': {
    background: '#2c313c',
    border: '1px solid #3e4451',
    borderRadius: '3px',
    color: '#abb2bf',
    cursor: 'pointer',
    padding: '2px 8px',
    marginRight: '4px',
  },
  '.cm-panel button:hover': {
    background: '#3e4451',
  },
  '.cm-panel label': {
    color: '#5c6370',
    marginRight: '8px',
    fontSize: '12px',
  },
  '.cm-panel .cm-panel-close': {
    float: 'right',
    cursor: 'pointer',
  },
});

// ── Sabit font ailesi eklentisi ───────────────────────────────────────────
const fontFamilyExt = EditorView.theme({
  '&': { fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" },
});

// ── Palet başına CodeMirror teması ──────────────────────────────────────────
const cmLightTheme = EditorView.theme({
  '&': { height: '100%', background: '#fafafa', color: '#383a42' },
  '.cm-content': { caretColor: '#007acc', minHeight: '100%' },
  '.cm-gutters': { background: '#f0f0f0', color: '#696c77', border: 'none', borderRight: '1px solid #ddd' },
  '.cm-activeLineGutter': { background: '#d8e6f5' },
  '.cm-activeLine': { background: '#edf4ff' },
  '.cm-selectionBackground, ::selection': { background: '#b3d4f5 !important' },
  '.cm-cursor': { borderLeftColor: '#007acc' },
  '.cm-matchingBracket': { background: '#c8d9eb', color: '#000 !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#fff', border: '1px solid #ddd', color: '#383a42' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#e8f0f8', color: '#000' },
  '.cm-panel': { background: '#f0f0f0', borderTop: '1px solid #ddd', color: '#383a42', padding: '6px 10px' },
  '.cm-panel input': { background: '#fff', border: '1px solid #ccc', borderRadius: '3px', color: '#383a42', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#007acc' },
  '.cm-panel button': { background: '#e8e8e8', border: '1px solid #ccc', borderRadius: '3px', color: '#383a42', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#d4d4d4' },
  '.cm-panel label': { color: '#696c77', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
}, { dark: false });

const cmDraculaTheme = EditorView.theme({
  '&': { height: '100%', background: '#282a36', color: '#f8f8f2' },
  '.cm-content': { caretColor: '#f8f8f0', minHeight: '100%' },
  '.cm-gutters': { background: '#282a36', color: '#6272a4', border: 'none', borderRight: '1px solid #191a21' },
  '.cm-activeLineGutter': { background: '#44475a' },
  '.cm-activeLine': { background: '#44475a' },
  '.cm-selectionBackground, ::selection': { background: '#44475a !important' },
  '.cm-cursor': { borderLeftColor: '#f8f8f0' },
  '.cm-matchingBracket': { background: '#6272a4', color: '#fff !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#21222c', border: '1px solid #191a21', color: '#f8f8f2' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#44475a', color: '#fff' },
  '.cm-panel': { background: '#21222c', borderTop: '1px solid #191a21', color: '#f8f8f2', padding: '6px 10px' },
  '.cm-panel input': { background: '#282a36', border: '1px solid #44475a', borderRadius: '3px', color: '#f8f8f2', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#bd93f9' },
  '.cm-panel button': { background: '#44475a', border: '1px solid #6272a4', borderRadius: '3px', color: '#f8f8f2', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#6272a4' },
  '.cm-panel label': { color: '#6272a4', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

const cmMonokaiTheme = EditorView.theme({
  '&': { height: '100%', background: '#272822', color: '#f8f8f2' },
  '.cm-content': { caretColor: '#f8f8f0', minHeight: '100%' },
  '.cm-gutters': { background: '#272822', color: '#75715e', border: 'none', borderRight: '1px solid #1a1b17' },
  '.cm-activeLineGutter': { background: '#3e3d32' },
  '.cm-activeLine': { background: '#3e3d32' },
  '.cm-selectionBackground, ::selection': { background: '#49483e !important' },
  '.cm-cursor': { borderLeftColor: '#f8f8f0' },
  '.cm-matchingBracket': { background: '#49483e', color: '#fff !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#1e1f1c', border: '1px solid #1a1b17', color: '#f8f8f2' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#3e3d32', color: '#fff' },
  '.cm-panel': { background: '#1e1f1c', borderTop: '1px solid #1a1b17', color: '#f8f8f2', padding: '6px 10px' },
  '.cm-panel input': { background: '#272822', border: '1px solid #49483e', borderRadius: '3px', color: '#f8f8f2', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#a6e22e' },
  '.cm-panel button': { background: '#3e3d32', border: '1px solid #75715e', borderRadius: '3px', color: '#f8f8f2', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#75715e' },
  '.cm-panel label': { color: '#75715e', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

const cmNordTheme = EditorView.theme({
  '&': { height: '100%', background: '#2e3440', color: '#d8dee9' },
  '.cm-content': { caretColor: '#eceff4', minHeight: '100%' },
  '.cm-gutters': { background: '#2e3440', color: '#4c566a', border: 'none', borderRight: '1px solid #1c2028' },
  '.cm-activeLineGutter': { background: '#3b4252' },
  '.cm-activeLine': { background: '#3b4252' },
  '.cm-selectionBackground, ::selection': { background: '#434c5e !important' },
  '.cm-cursor': { borderLeftColor: '#d8dee9' },
  '.cm-matchingBracket': { background: '#4c566a', color: '#eceff4 !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#242933', border: '1px solid #1c2028', color: '#d8dee9' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#3b4252', color: '#eceff4' },
  '.cm-panel': { background: '#242933', borderTop: '1px solid #1c2028', color: '#d8dee9', padding: '6px 10px' },
  '.cm-panel input': { background: '#2e3440', border: '1px solid #434c5e', borderRadius: '3px', color: '#d8dee9', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#88c0d0' },
  '.cm-panel button': { background: '#3b4252', border: '1px solid #4c566a', borderRadius: '3px', color: '#d8dee9', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#4c566a' },
  '.cm-panel label': { color: '#4c566a', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

const cmSolarizedTheme = EditorView.theme({
  '&': { height: '100%', background: '#002b36', color: '#839496' },
  '.cm-content': { caretColor: '#839496', minHeight: '100%' },
  '.cm-gutters': { background: '#002b36', color: '#586e75', border: 'none', borderRight: '1px solid #00212b' },
  '.cm-activeLineGutter': { background: '#073642' },
  '.cm-activeLine': { background: '#073642' },
  '.cm-selectionBackground, ::selection': { background: '#0d4a5a !important' },
  '.cm-cursor': { borderLeftColor: '#819090' },
  '.cm-matchingBracket': { background: '#073642', color: '#eee8d5 !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#001e26', border: '1px solid #00212b', color: '#839496' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#073642', color: '#eee8d5' },
  '.cm-panel': { background: '#001e26', borderTop: '1px solid #00212b', color: '#839496', padding: '6px 10px' },
  '.cm-panel input': { background: '#002b36', border: '1px solid #073642', borderRadius: '3px', color: '#839496', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#268bd2' },
  '.cm-panel button': { background: '#073642', border: '1px solid #586e75', borderRadius: '3px', color: '#839496', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#0d4a5a' },
  '.cm-panel label': { color: '#586e75', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

const cmPinkTheme = EditorView.theme({
  '&': { height: '100%', background: '#fff0f5', color: '#4a2040' },
  '.cm-content': { caretColor: '#c2185b', minHeight: '100%' },
  '.cm-gutters': { background: '#fce4ec', color: '#ad1464', border: 'none', borderRight: '1px solid #f8bbd0' },
  '.cm-activeLineGutter': { background: '#f8bbd0' },
  '.cm-activeLine': { background: '#fce4ec' },
  '.cm-selectionBackground, ::selection': { background: '#f48fb1 !important' },
  '.cm-cursor': { borderLeftColor: '#c2185b' },
  '.cm-matchingBracket': { background: '#f8bbd0', color: '#4a2040 !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#fce4ec', border: '1px solid #f8bbd0', color: '#4a2040' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#f48fb1', color: '#fff' },
  '.cm-panel': { background: '#fce4ec', borderTop: '1px solid #f8bbd0', color: '#4a2040', padding: '6px 10px' },
  '.cm-panel input': { background: '#fff0f5', border: '1px solid #f48fb1', borderRadius: '3px', color: '#4a2040', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#c2185b' },
  '.cm-panel button': { background: '#f8bbd0', border: '1px solid #f48fb1', borderRadius: '3px', color: '#4a2040', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#f48fb1' },
  '.cm-panel label': { color: '#ad1464', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
}, { dark: false });

const cmBlueKidsTheme = EditorView.theme({
  '&': { height: '100%', background: '#e8f4fd', color: '#1a3a5c' },
  '.cm-content': { caretColor: '#0277bd', minHeight: '100%' },
  '.cm-gutters': { background: '#bbdefb', color: '#1565c0', border: 'none', borderRight: '1px solid #90caf9' },
  '.cm-activeLineGutter': { background: '#90caf9' },
  '.cm-activeLine': { background: '#bbdefb' },
  '.cm-selectionBackground, ::selection': { background: '#64b5f6 !important' },
  '.cm-cursor': { borderLeftColor: '#0277bd' },
  '.cm-matchingBracket': { background: '#90caf9', color: '#1a3a5c !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#e3f2fd', border: '1px solid #bbdefb', color: '#1a3a5c' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#64b5f6', color: '#fff' },
  '.cm-panel': { background: '#bbdefb', borderTop: '1px solid #90caf9', color: '#1a3a5c', padding: '6px 10px' },
  '.cm-panel input': { background: '#e8f4fd', border: '1px solid #64b5f6', borderRadius: '3px', color: '#1a3a5c', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#0277bd' },
  '.cm-panel button': { background: '#90caf9', border: '1px solid #64b5f6', borderRadius: '3px', color: '#1a3a5c', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#64b5f6' },
  '.cm-panel label': { color: '#1565c0', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
}, { dark: false });

const cmPurpleTheme = EditorView.theme({
  '&': { height: '100%', background: '#1a0a2e', color: '#e1d5f7' },
  '.cm-content': { caretColor: '#ce93d8', minHeight: '100%' },
  '.cm-gutters': { background: '#2d1b4e', color: '#9c5fc0', border: 'none', borderRight: '1px solid #4a2070' },
  '.cm-activeLineGutter': { background: '#3d2060' },
  '.cm-activeLine': { background: '#2d1b4e' },
  '.cm-selectionBackground, ::selection': { background: '#6a1b9a !important' },
  '.cm-cursor': { borderLeftColor: '#ce93d8' },
  '.cm-matchingBracket': { background: '#3d2060', color: '#e1d5f7 !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#220d38', border: '1px solid #4a2070', color: '#e1d5f7' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#6a1b9a', color: '#fff' },
  '.cm-panel': { background: '#2d1b4e', borderTop: '1px solid #4a2070', color: '#e1d5f7', padding: '6px 10px' },
  '.cm-panel input': { background: '#1a0a2e', border: '1px solid #7b2fbe', borderRadius: '3px', color: '#e1d5f7', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#ce93d8' },
  '.cm-panel button': { background: '#3d2060', border: '1px solid #7b2fbe', borderRadius: '3px', color: '#e1d5f7', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#6a1b9a' },
  '.cm-panel label': { color: '#ce93d8', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

const cmMagentaTheme = EditorView.theme({
  '&': { height: '100%', background: '#1a0014', color: '#f5d0ff' },
  '.cm-content': { caretColor: '#ea80fc', minHeight: '100%' },
  '.cm-gutters': { background: '#2e0028', color: '#bf40ff', border: 'none', borderRight: '1px solid #5a0050' },
  '.cm-activeLineGutter': { background: '#3d0040' },
  '.cm-activeLine': { background: '#2e0028' },
  '.cm-selectionBackground, ::selection': { background: '#7b00d4 !important' },
  '.cm-cursor': { borderLeftColor: '#ea80fc' },
  '.cm-matchingBracket': { background: '#3d0040', color: '#f5d0ff !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#200018', border: '1px solid #5a0050', color: '#f5d0ff' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#7b00d4', color: '#fff' },
  '.cm-panel': { background: '#2e0028', borderTop: '1px solid #5a0050', color: '#f5d0ff', padding: '6px 10px' },
  '.cm-panel input': { background: '#1a0014', border: '1px solid #bf00ff', borderRadius: '3px', color: '#f5d0ff', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#ea80fc' },
  '.cm-panel button': { background: '#3d0040', border: '1px solid #bf00ff', borderRadius: '3px', color: '#f5d0ff', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#7b00d4' },
  '.cm-panel label': { color: '#ea80fc', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

const cmFuchsiaTheme = EditorView.theme({
  '&': { height: '100%', background: '#0f001a', color: '#ffd6ec' },
  '.cm-content': { caretColor: '#ff80ab', minHeight: '100%' },
  '.cm-gutters': { background: '#220030', color: '#ff4081', border: 'none', borderRight: '1px solid #500040' },
  '.cm-activeLineGutter': { background: '#2e0040' },
  '.cm-activeLine': { background: '#220030' },
  '.cm-selectionBackground, ::selection': { background: '#880e4f !important' },
  '.cm-cursor': { borderLeftColor: '#ff80ab' },
  '.cm-matchingBracket': { background: '#2e0040', color: '#ffd6ec !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#140020', border: '1px solid #500040', color: '#ffd6ec' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#880e4f', color: '#fff' },
  '.cm-panel': { background: '#220030', borderTop: '1px solid #500040', color: '#ffd6ec', padding: '6px 10px' },
  '.cm-panel input': { background: '#0f001a', border: '1px solid #f50057', borderRadius: '3px', color: '#ffd6ec', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#ff80ab' },
  '.cm-panel button': { background: '#2e0040', border: '1px solid #f50057', borderRadius: '3px', color: '#ffd6ec', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#880e4f' },
  '.cm-panel label': { color: '#ff80ab', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

const cmCyanTheme = EditorView.theme({
  '&': { height: '100%', background: '#001a1a', color: '#b2f0f0' },
  '.cm-content': { caretColor: '#4dd0e1', minHeight: '100%' },
  '.cm-gutters': { background: '#002b2b', color: '#00acc1', border: 'none', borderRight: '1px solid #005050' },
  '.cm-activeLineGutter': { background: '#003838' },
  '.cm-activeLine': { background: '#002b2b' },
  '.cm-selectionBackground, ::selection': { background: '#006064 !important' },
  '.cm-cursor': { borderLeftColor: '#4dd0e1' },
  '.cm-matchingBracket': { background: '#003838', color: '#b2f0f0 !important' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: '#002020', border: '1px solid #005050', color: '#b2f0f0' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#006064', color: '#fff' },
  '.cm-panel': { background: '#002b2b', borderTop: '1px solid #005050', color: '#b2f0f0', padding: '6px 10px' },
  '.cm-panel input': { background: '#001a1a', border: '1px solid #00bcd4', borderRadius: '3px', color: '#b2f0f0', padding: '2px 6px', outline: 'none', marginRight: '4px' },
  '.cm-panel input:focus': { borderColor: '#4dd0e1' },
  '.cm-panel button': { background: '#003838', border: '1px solid #00bcd4', borderRadius: '3px', color: '#b2f0f0', cursor: 'pointer', padding: '2px 8px', marginRight: '4px' },
  '.cm-panel button:hover': { background: '#006064' },
  '.cm-panel label': { color: '#4dd0e1', marginRight: '8px', fontSize: '12px' },
  '.cm-panel .cm-panel-close': { float: 'right', cursor: 'pointer' },
});

// ── Tema haritası: CSS body class → CodeMirror extension listesi ─────────────
const CM_THEMES = {
  '':          [oneDark, melpTheme],
  'light':     [syntaxHighlighting(defaultHighlightStyle), cmLightTheme],
  'dracula':   [oneDark, cmDraculaTheme],
  'monokai':   [oneDark, cmMonokaiTheme],
  'nord':      [oneDark, cmNordTheme],
  'solarized': [oneDark, cmSolarizedTheme],
  'pink':      [syntaxHighlighting(defaultHighlightStyle), cmPinkTheme],
  'blue-kids': [syntaxHighlighting(defaultHighlightStyle), cmBlueKidsTheme],
  'purple':    [oneDark, cmPurpleTheme],
  'magenta':   [oneDark, cmMagentaTheme],
  'fuchsia':   [oneDark, cmFuchsiaTheme],
  'cyan':      [oneDark, cmCyanTheme],
};

// ── Dinamik compartment'lar ──────────────────────────────────────────────────
const themeCompartment    = new Compartment();
const fontSizeCompartment = new Compartment();

function fontSizeExt(px) {
  return EditorView.theme({ '&': { fontSize: px } });
}

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
      autocompletion({ override: [melpCompletionSource] }),
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
      themeCompartment.of(CM_THEMES['']),
      fontFamilyExt,
      fontSizeCompartment.of(fontSizeExt('14px')),
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

/** Editörün CodeMirror temasını değiştirir */
export function setEditorTheme(view, themeName) {
  const theme = CM_THEMES[themeName] ?? CM_THEMES[''];
  view.dispatch({ effects: themeCompartment.reconfigure(theme) });
}

/** Editörün yazı boyutunu değiştirir (örn. '14px') */
export function setEditorFontSize(view, px) {
  view.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeExt(px)) });
}
