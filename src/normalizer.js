// MELP Normalizer — tarayıcı tarafı ön-işleme katmanı
// C++ normalizer.cpp ile aynı mantığı JS'de uygular.
// Akış: kaynak kod → normalizeLanguage → normalizeSyntax → MELP derleyici

import dillerData from './diller.json';
import syntaxData from './syntax.json';

// Kullanıcı tanımlı özel keyword haritaları (localStorage'den yüklenir)
const _customMaps = {};
export function setCustomLanguageMap(lang, mapObj) {
  _customMaps[lang] = mapObj || {};
}

// ── Yardımcılar ───────────────────────────────────────────────────────────
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Dil normalleştirme ────────────────────────────────────────────────────
// Turkish "fonksiyon" → "function", "eğer" → "if", vb.
export function normalizeLanguage(code, lang) {
  if (!lang || lang === 'english') return code;
  const langDef = dillerData.languages[lang];
  if (!langDef || !langDef.enabled) return code;

  const baseKeywords = langDef.keywords || {};
  // Özel harita base'in üzerine yazılır (kullanıcı tanımlı öncelikli)
  const keywords = { ...baseKeywords, ...(_customMaps[lang] || {}) };
  // Uzun anahtar kelimeleri önce uygula (greedy match)
  const sorted = Object.entries(keywords)
    .sort((a, b) => b[0].length - a[0].length);

  let result = code;
  for (const [from, to] of sorted) {
    result = result.replace(
      new RegExp(`(?<![\\w\\u00C0-\\u024F])${escRe(from)}(?![\\w\\u00C0-\\u024F])`, 'gi'),
      to
    );
  }
  return result;
}

// ── Sözdizimi normalleştirme ─────────────────────────────────────────────
// VB.NET "If x Then" → "if x then", "End Function" → "end_function", vb.
export function normalizeSyntax(code, syntax) {
  if (!syntax || syntax === 'pmpl') return code;
  const synDef = syntaxData.syntaxes[syntax];
  if (!synDef || !synDef.enabled) return code;

  const patterns = synDef.patterns || [];
  const lines = code.split('\n');
  const result = [];

  for (const line of lines) {
    let out = line;
    for (const p of patterns) {
      if (!p.match || !p.replace) continue;
      try {
        const re = new RegExp(p.match, 'i');
        if (re.test(out)) {
          // $1, $2 .. referanslarını destekle
          out = out.replace(re, p.replace.replace(/\$(\d+)/g, '$$$1'));
          break; // bir satıra bir kural uygula
        }
      } catch (_) { /* geçersiz regex — atla */ }
    }
    result.push(out);
  }
  return result.join('\n');
}

// ── Birleşik normalleştirme ──────────────────────────────────────────────
export function normalize(code, lang, syntax) {
  let out = normalizeLanguage(code, lang);
  out = normalizeSyntax(out, syntax);
  return out;
}

// ── Mevcut seçenekleri döndür (dropdown için) ────────────────────────────
export function getLanguageOptions() {
  return Object.entries(dillerData.languages)
    .filter(([, v]) => v.enabled)
    .map(([id, v]) => ({ id, name: v.description || id }));
}

export function getSyntaxOptions() {
  return Object.entries(syntaxData.syntaxes)
    .filter(([, v]) => v.enabled)
    .map(([id, v]) => ({ id, name: v.description || id }));
}

export function getDefaultKeywords(lang) {
  const langDef = dillerData.languages[lang];
  return langDef ? (langDef.keywords || {}) : {};
}
