// MELP Dili — CodeMirror 6 StreamLanguage tanımı
// VSIX'teki mlp.tmLanguage.json ile sync tutulur

import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// ── Anahtar kelimeler ──────────────────────────────────────────────────────
const KEYWORDS = new Set([
  // Fonksiyon
  'function', 'end_function', 'method', 'return', 'as',
  // Tip
  'none', 'numeric', 'boolean', 'text',
  // Koşul
  'if', 'then', 'else', 'else_if', 'end_if',
  // Döngü
  'while', 'end_while', 'for', 'to', 'downto', 'end_for',
  'exit', 'continue',
  // Yapı
  'struct', 'end_struct', 'enum', 'end_enum',
  'interface', 'end_interface', 'implement', 'end_implement',
  // Modül
  'module', 'end_module', 'import', 'from',
  // Kapsam
  'scope', 'end_scope', 'spawn', 'end_spawn',
  // Test
  'test', 'end_test', 'assert', 'do',
  // Async
  'async', 'await', 'external',
  // Kontrol
  'match', 'end_match', 'try', 'end_try',
  'lambda', 'end_lambda', 'event', 'end_event',
  // Değer
  'true', 'false', 'null', 'self',
  // Debug
  'debug', 'end_debug', 'pause',
  // Mantık
  'and', 'or', 'not',
  // Tür
  'type',
]);

const BUILTINS = new Set([
  'print', 'println', 'input',
  'len', 'range', 'push', 'pop',
  'map', 'filter', 'reduce', 'fold', 'zip',
  'Ok', 'Err', 'Some', 'None', 'Result', 'Option',
  'assert', 'panic', 'todo', 'unreachable',
  'read_arg', 'append_file', 'write_file', 'read_file',
]);

const TYPES = new Set([
  'numeric', 'boolean', 'text', 'none',
  'i8','i16','i32','i64', 'u8','u16','u32','u64',
  'f32','f64',
]);

// ── Stream tokenizer ───────────────────────────────────────────────────────
const melpLanguage = StreamLanguage.define({
  name: 'melp',

  startState() {
    return { inString: false, stringChar: null, inComment: false };
  },

  token(stream, state) {
    // Blok yorum {- ... -}
    if (state.inComment) {
      if (stream.match('-}')) { state.inComment = false; return 'comment'; }
      stream.next();
      return 'comment';
    }

    if (stream.eatSpace()) return null;

    // Tek satır yorum --
    if (stream.match('--')) { stream.skipToEnd(); return 'lineComment'; }

    // Blok yorum {-
    if (stream.match('{-')) { state.inComment = true; return 'comment'; }

    // String " veya '
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '\\') { stream.next(); continue; }
        if (c === ch) break;
      }
      return 'string';
    }

    // Sayılar
    if (stream.match(/^0x[0-9a-fA-F_]+/)) return 'number';
    if (stream.match(/^0b[01_]+/))         return 'number';
    if (stream.match(/^[0-9][0-9.]*([,][0-9]+)?/)) return 'number';

    // Operatörler
    if (stream.match(/^(=>|::|\.\.=|\.\.\||>=|<=|!=|==|&&|\|\||[+\-*\/%&|^~<>=!]=?|[{}()[\]:,@.])/)) {
      return 'operator';
    }

    // Tanımlayıcı / anahtar kelime
    if (stream.match(/^[a-zA-Z_çğıöşüÇĞİÖŞÜ][a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word))  return 'keyword';
      if (BUILTINS.has(word))  return 'builtin';
      if (TYPES.has(word))     return 'typeName';
      if (/^[A-Z]/.test(word)) return 'typeName';
      if (stream.peek() === '(') return 'variableName';
      return 'variableName';
    }

    stream.next();
    return null;
  },

  tokenTable: {
    lineComment:  t.lineComment,
    comment:      t.blockComment,
    string:       t.string,
    number:       t.number,
    keyword:      t.keyword,
    builtin:      t.function(t.name),
    typeName:     t.typeName,
    operator:     t.operator,
    variableName: t.variableName,
  },
});

// ── Renk teması ────────────────────────────────────────────────────────────
const melpHighlight = HighlightStyle.define([
  { tag: t.keyword,           color: '#c678dd' },
  { tag: t.function(t.name),  color: '#61afef' },
  { tag: t.typeName,          color: '#e5c07b' },
  { tag: t.string,            color: '#98c379' },
  { tag: t.number,            color: '#d19a66' },
  { tag: t.operator,          color: '#56b6c2' },
  { tag: t.lineComment,       color: '#5c6370', fontStyle: 'italic' },
  { tag: t.blockComment,      color: '#5c6370', fontStyle: 'italic' },
  { tag: t.variableName,      color: '#abb2bf' },
]);

export const melpLanguageExtension = [
  melpLanguage,
  syntaxHighlighting(melpHighlight),
];
