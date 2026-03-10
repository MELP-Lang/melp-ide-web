// MELP Web Editörü — app-web.js
// Electron bağımlılıkları kaldırıldı; tarayıcı File API + fetch kullanır
'use strict';

// ── WASM Backend (tarayıcı içi derleme) ────────────────────────────────────
// melp_compiler.wasm: MeLP kaynak kodu → WASM binary (LLVM olmadan)
// Aktivasyon: backend.compile() içindeki return satırını değiştir.
let _melpModule = null;
async function _loadMelpModule() {
  if (_melpModule) return _melpModule;
  // MelpCompiler() global'i melp_compiler.js yüklenince tanımlanır
  if (typeof MelpCompiler === 'undefined') {
    throw new Error('melp_compiler.js yüklenmemiş. index.html\'e ekle: <script src="wasm/melp_compiler.js"></script>');
  }
  _melpModule = await MelpCompiler();
  return _melpModule;
}

// Kullanıcı WASM binary'sini tarayıcıda çalıştırmak için basit WASI polyfill
async function _execWasm(wasmBytes) {
  let stdout = '';
  const importObject = {
    wasi_snapshot_preview1: {
      fd_write(fd, iovPtr, iovCnt, nwrittenPtr) {
        const mem = new DataView(instance.exports.memory.buffer);
        let written = 0;
        for (let i = 0; i < iovCnt; i++) {
          const base = mem.getUint32(iovPtr + i * 8,     true);
          const len  = mem.getUint32(iovPtr + i * 8 + 4, true);
          const bytes = new Uint8Array(instance.exports.memory.buffer, base, len);
          stdout += new TextDecoder().decode(bytes);
          written += len;
        }
        mem.setUint32(nwrittenPtr, written, true);
        return 0;
      },
      proc_exit(code) { throw { exitCode: code }; },
      environ_get()          { return 0; },
      environ_sizes_get()    { return 0; },
      args_get()             { return 0; },
      args_sizes_get()       { return 0; },
      clock_time_get()       { return 0; },
      clock_res_get()        { return 0; },
    }
  };
  let instance;
  ({ instance } = await WebAssembly.instantiate(wasmBytes, importObject));
  try {
    instance.exports._start?.();
    instance.exports.main?.();
  } catch (e) {
    if (e && typeof e.exitCode !== 'undefined' && e.exitCode !== 0) {
      return { stdout, stderr: `exit code ${e.exitCode}`, exitCode: e.exitCode };
    }
  }
  return { stdout, stderr: '', exitCode: 0 };
}

const wasmBackend = {
  async compile(code, run) {
    const mod = await _loadMelpModule();
    const rc = mod.ccall('melp_compile', 'number', ['string'], [code]);
    if (rc !== 0) {
      const errStr = mod.ccall('melp_get_error', 'string', [], []);
      return { stdout: '', stderr: errStr || 'Derleme hatası', exitCode: 1 };
    }
    const size = mod.ccall('melp_get_wasm_size', 'number', [], []);
    const ptr  = mod.ccall('melp_get_wasm_ptr',  'number', [], []);
    const wasmBytes = new Uint8Array(mod.HEAPU8.buffer, ptr, size).slice();

    if (!run) {
      // Sadece derleme — başarı mesajı döndür
      return { stdout: `✅ Derleme başarılı (${size} byte WASM)\n`, stderr: '', exitCode: 0 };
    }
    // Çalıştır
    return _execWasm(wasmBytes);
  }
};

// ── Backend adaptörü ───────────────────────────────────────────────────────
const backend = {
  async compile(code, run) {
    return wasmBackend.compile(code, run);
  }
};

// ── Yardımcı ───────────────────────────────────────────────────────────────
function basename(p) {
  return p ? (p.split('/').pop() || p.split('\\').pop() || p) : 'untitled.mlp';
}

// ── Durum ──────────────────────────────────────────────────────────────────
const state = {
  editor:     null,
  modified:   false,
  tabs:       [],
  activeTab:  null,  lang:       localStorage.getItem('melp-lang')   || 'english',
  syntax:     localStorage.getItem('melp-syntax') || 'pmpl',};

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const editorEl   = $('editor-container');
const tabsEl     = $('tabs');
const statusText = $('status-text');
const cursorInfo = $('cursor-info');
const outputEl   = $('output-panel');

// ── Editör başlat ──────────────────────────────────────────────────────────
const DEFAULT_CONTENT =
`#lang english
#syntax pmpl

-- Merhaba, MELP!
function main()
    print("Merhaba, Dünya!")
end_function
`;

// ── #lang / #syntax direktif yardımcıları ─────────────────────────────────────
function parseAndStripDirectives(code) {
  const lines = code.split('\n');
  let lang = null, syntax = null;
  const kept = [];
  let scanning = true;
  for (let i = 0; i < lines.length; i++) {
    const tr = lines[i].trim();
    if (scanning) {
      if (tr === '' || tr.startsWith('--')) { kept.push(lines[i]); continue; }
      if (tr.startsWith('#lang '))   { lang   = tr.slice(6).trim();  continue; }
      if (tr.startsWith('#syntax ')) { syntax = tr.slice(8).trim();  continue; }
      scanning = false;
    }
    kept.push(lines[i]);
  }
  return { lang, syntax, clean: kept.join('\n') };
}

function buildDirectiveHeader(lang, syntax) {
  return `#lang ${lang || 'english'}\n#syntax ${syntax || 'pmpl'}\n`;
}

// Editördeki direktiflerden dropdown + state.lang/syntax güncelle (setValue yok)
function syncDropdownsFromEditorContent() {
  if (!state.editor) return;
  const { lang, syntax } = parseAndStripDirectives(state.editor.getValue());
  if (lang && lang !== state.lang) {
    state.lang = lang;
    localStorage.setItem('melp-lang', lang);
    const ls = $('sel-lang'); if (ls) ls.value = lang;
  }
  if (syntax && syntax !== state.syntax) {
    state.syntax = syntax;
    localStorage.setItem('melp-syntax', syntax);
    const ss = $('sel-syntax'); if (ss) ss.value = syntax;
  }
}

// Dropdown değişince editorün en üstündeki direktifleri güncelle
function updateDirectivesInEditor() {
  if (!state.editor || state.activeTab === null) return;
  const { clean } = parseAndStripDirectives(state.editor.getValue());
  const newCode = buildDirectiveHeader(state.lang, state.syntax) + clean;
  state.editor.setValue(newCode);
  state.tabs[state.activeTab].content = newCode;
}

// ── Özel keyword haritası ─────────────────────────────────────────────────
// Display format: "canonical = alias"  (örn. print = yaz)
// Storage format: "canonical = alias" (aynı — textarea içeriği doğrudan kaydedilir)
// Normalizer format: {alias: canonical} — apply sırasında çevrilir

function _textToNormalizerMap(text) {
  // "canonical = alias" satırlarını parse edip {alias: canonical} döndürür
  const map = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('--')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const canonical = t.slice(0, eq).trim();
    const alias     = t.slice(eq + 1).trim();
    if (canonical && alias) map[alias] = canonical;
  }
  return map;
}

function buildDisplayText(lang) {
  // Tüm varsayılan eşleşmeleri "canonical = alias" formatında döndürür.
  // Kaydedilmiş özelleştirmeler varsa ilgili canonical satırını override eder.
  // English için: kanonik dil, çeviriye gerek yok.
  try {
    const defaults = MelpEditor.getDefaultKeywords ? MelpEditor.getDefaultKeywords(lang) : {};
    if (!defaults || Object.keys(defaults).length === 0) {
      return '-- Bu dil kanonik dildir (English).\n-- Keyword dönüşümü gerekmez.\n-- Farklı bir dil seçip tekrar açın.';
    }
    // defaults: {alias → canonical}  →  byCanonical: {canonical → alias} (ilk alias alınır)
    const byCanonical = {};
    for (const [alias, canonical] of Object.entries(defaults)) {
      if (!byCanonical[canonical]) byCanonical[canonical] = alias;
    }
    // Kaydedilmiş özelleştirme varsa override et
    const saved = localStorage.getItem('melp-custom-map-' + lang) || '';
    for (const line of saved.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('--')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const canonical = t.slice(0, eq).trim();
      const alias     = t.slice(eq + 1).trim();
      if (canonical && alias && Object.prototype.hasOwnProperty.call(byCanonical, canonical))
        byCanonical[canonical] = alias;
    }
    return Object.entries(byCanonical).map(([c, a]) => `${c} = ${a}`).join('\n');
  } catch(e) { return ''; }
}

function applyCustomKeywords(lang) {
  const text = localStorage.getItem('melp-custom-map-' + lang) || '';
  try { MelpEditor.setCustomLanguageMap(lang, _textToNormalizerMap(text)); } catch(e) {}
}

function applyAllSavedCustomMaps() {
  ['turkish','russian','arabic','chinese'].forEach(applyCustomKeywords);
}

function initEditor() {
  state.editor = MelpEditor.createEditor(editorEl, DEFAULT_CONTENT);

  window.onEditorChange = () => {
    markModified();
    updateCursorInfo();
  };

  _createUntitledTab(DEFAULT_CONTENT);
}

let untitledCounter = 1;

function _createUntitledTab(content = '') {
  const label = `untitled-${untitledCounter++}.mlp`;
  state.tabs.push({ path: null, label, content, modified: false });
  state.activeTab = state.tabs.length - 1;
  renderTabs();
  setStatus(label);
}

// ── Tab yönetimi ────────────────────────────────────────────────────────────
function openTab(filePath, content) {
  if (filePath) {
    const existing = state.tabs.findIndex(t => t.path === filePath);
    if (existing >= 0) { activateTab(existing); return; }
  }
  const label = filePath ? basename(filePath) : `untitled-${untitledCounter++}.mlp`;
  state.tabs.push({ path: filePath, label, content, modified: false });
  activateTab(state.tabs.length - 1);
  renderTabs();
}

function activateTab(idx) {
  if (state.activeTab !== null && state.editor) {
    state.tabs[state.activeTab].content = state.editor.getValue();
  }
  state.activeTab = idx;
  const tab = state.tabs[idx];
  state.editor.setValue(tab.content);
  syncDropdownsFromEditorContent();
  state.editor.focus();
  renderTabs();
  setStatus(tab.label);
}

function closeTab(idx) {
  // splice'dan önce mevcut içeriği kaydet
  if (state.activeTab !== null && state.editor) {
    state.tabs[state.activeTab].content = state.editor.getValue();
  }
  state.tabs.splice(idx, 1);
  if (state.tabs.length === 0) {
    state.activeTab = null;
    state.editor.setValue('');
    renderTabs();
  } else {
    // activeTab index'ini ayarla: kapatılan sekme öncesindeyse kaydır
    let newActive = state.activeTab;
    if (idx < state.activeTab) {
      newActive = state.activeTab - 1;
    } else if (idx === state.activeTab) {
      newActive = Math.min(idx, state.tabs.length - 1);
    }
    state.activeTab = null; // activateTab içinde çift kayıt olmasın
    activateTab(newActive);
  }
}

function markModified() {
  if (state.activeTab === null) return;
  state.tabs[state.activeTab].modified = true;
  renderTabs();
}

function renderTabs() {
  tabsEl.innerHTML = '';
  state.tabs.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === state.activeTab ? ' active' : '') + (tab.modified ? ' modified' : '');
    el.innerHTML = `<span class="tab-label">${escHtml(tab.label)}</span>`
                 + `<span class="tab-close" data-i="${i}">×</span>`;
    el.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('.tab-close');
      if (closeBtn) {
        e.stopPropagation();
        closeTab(parseInt(closeBtn.dataset.i, 10));
      } else {
        activateTab(i);
      }
    });
    tabsEl.appendChild(el);
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Dosya işlemleri (File API) ─────────────────────────────────────────────
function newFile() {
  openTab(null, buildDirectiveHeader(state.lang, state.syntax));
  setStatus('Yeni dosya');
}

function openFileFromDisk() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.mlp,.mlpgui,.ll,.txt';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      openTab(file.name, ev.target.result);
      setStatus('📄 ' + file.name);
    };
    reader.readAsText(file, 'utf-8');
  });
  input.click();
}

// Blob indirme — Ctrl+S
function saveFile() {
  const content = state.editor.getValue();
  const label   = state.tabs[state.activeTab]?.label ?? 'untitled.mlp';
  const blob    = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = label;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (state.activeTab !== null) {
    state.tabs[state.activeTab].modified = false;
    state.tabs[state.activeTab].content  = content;
  }
  renderTabs();
  setStatus('✅ İndirildi: ' + label);
}

// ── Örnekler paneli ───────────────────────────────────────────────────────
const EXAMPLES = [
  {
    label: 'Merhaba Dünya',
    code: `function main()\n    print("Merhaba, Dünya!")\nend_function\n`,
  },
  {
    label: 'Fibonacci',
    code: `function fib(n as numeric) as numeric\n    if n <= 1 then\n        return n\n    end_if\n    return fib(n - 1) + fib(n - 2)\nend_function\n\nfunction main()\n    for i = 0 to 10\n        print(fib(i))\n    end_for\nend_function\n`,
  },
  {
    label: 'Döngüler',
    code: `function main()\n    -- while örneği\n    let i = 0\n    while i < 5\n        print(i)\n        i = i + 1\n    end_while\n\n    -- for örneği\n    for j = 1 to 5\n        print(j * j)\n    end_for\nend_function\n`,
  },
  {
    label: 'Struct',
    code: `struct Nokta\n    x as numeric\n    y as numeric\nend_struct\n\nfunction main()\n    Nokta a\n    a.x = 3\n    a.y = 4\n    Nokta b\n    b.x = 1\n    b.y = 2\n    print(a.x + b.x)\n    print(a.y + b.y)\nend_function\n`,
  },
  {
    label: 'Enum + Match',
    code: `enum Renk\n    Kirmizi\n    Yesil\n    Mavi\nend_enum\n\nfunction main()\n    numeric r = Renk.Kirmizi\n    match r\n        case Renk.Kirmizi then print("kirmizi")\n        case Renk.Yesil   then print("yesil")\n        case Renk.Mavi    then print("mavi")\n    end_match\n    return 0\nend_function\n`,
  },
  {
    label: 'Try / Hata',
    code: `function bolme(numeric a; numeric b) as numeric\n    if b == 0 then\n        throw "sifira bolme!"\n    end_if\n    return a / b\nend_function\n\nfunction main()\n    try\n        numeric r = bolme(10; 0)\n        print(r)\n    catch e\n        print("hata: sifira bolme")\n    end_try\n    return 0\nend_function\n`,
  },
  // ── Türkçe + PMPL ──────────────────────────────────────────────────────
  {
    label: 'Merhaba (TR)',
    lang: 'turkish', syntax: 'pmpl',
    code: `fonksiyon ana()\n    print("Merhaba, Dünya!")\nfonksiyon_sonu\n`,
  },
  {
    label: 'Fibonacci (TR)',
    lang: 'turkish', syntax: 'pmpl',
    code: `fonksiyon fib(n olarak sayı) olarak sayı\n    eğer n <= 1 sonra\n        döndür n\n    end_if\n    döndür fib(n - 1) + fib(n - 2)\nfonksiyon_sonu\n\nfonksiyon ana()\n    için i = 0 to 10\n        print(fib(i))\n    end_for\nfonksiyon_sonu\n`,
  },
  // ── English + VB.NET ───────────────────────────────────────────────────
  {
    label: 'Merhaba (VB)',
    lang: 'english', syntax: 'vbnet',
    code: `Sub Main()\n    Print("Merhaba, Dünya!")\nEnd Sub\n`,
  },
  {
    label: 'Topla (VB)',
    lang: 'english', syntax: 'vbnet',
    code: `Function Topla(a As numeric; b As numeric) As numeric\n    Return a + b\nEnd Function\n\nSub Main()\n    If Topla(3; 5) > 7 Then\n        Print("büyük")\n    End If\nEnd Sub\n`,
  },
  // ── English + Python-Style ─────────────────────────────────────────────
  {
    label: 'Merhaba (PY)',
    lang: 'english', syntax: 'python_style',
    code: `def main():\n    print("Merhaba, Dünya!")\n`,
  },
  {
    label: 'Topla (PY)',
    lang: 'english', syntax: 'python_style',
    code: `def topla(a, b):\n    return a + b\n\ndef main():\n    sonuc = topla(3; 5)\n    if sonuc > 7:\n        print("büyük")\n    else:\n        print("küçük")\n`,
  },
];

const LANG_SHORT = { english:'EN', turkish:'TR', russian:'RU', arabic:'AR', chinese:'ZH' };
const SYN_SHORT  = { pmpl:'PMPL', c_style:'C', python_style:'PY', go_style:'Go', rust_style:'RS', vbnet:'VB' };

function loadExamplesPanel() {
  const container = $('examples-list');
  if (!container) return;
  EXAMPLES.forEach(ex => {
    const el = document.createElement('div');
    el.className = 'tree-file';
    el.title = ex.label + '.mlp';

    const langKey = ex.lang   || 'english';
    const synKey  = ex.syntax || 'pmpl';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = ex.label;
    el.appendChild(labelSpan);

    if (langKey !== 'english' || synKey !== 'pmpl') {
      const badge = document.createElement('span');
      badge.className   = 'example-badge';
      badge.textContent = (LANG_SHORT[langKey] || langKey.slice(0,2).toUpperCase())
                        + ' ' + (SYN_SHORT[synKey] || synKey.toUpperCase());
      el.appendChild(badge);
    }

    el.addEventListener('click', () => {
      // Direktifleri kodun başına ekle — activateTab → syncDropdownsFromEditorContent bunları okuyacak
      const header = buildDirectiveHeader(langKey, synKey);
      openTab(ex.label + '.mlp', header + ex.code);
    });
    container.appendChild(el);
  });
}

// ── Derleme & çalıştırma ──────────────────────────────────────────────
async function compile(andRun = false) {
  const raw = state.editor.getValue();
  // Dosya başındaki #lang / #syntax direktiflerini oku ve soy (WASM bunları anlamaz)
  const { lang: fileLang, syntax: fileSyntax, clean } = parseAndStripDirectives(raw);
  const effectiveLang   = fileLang   || state.lang;
  const effectiveSyntax = fileSyntax || state.syntax;

  let code = clean;
  let normInfo = '';
  // Normalleştirme: Türkçe/VBNet vb. → MELP standart sözdizimi
  if (effectiveLang !== 'english' || effectiveSyntax !== 'pmpl') {
    try {
      code = MelpEditor.normalize(code, effectiveLang, effectiveSyntax);
      normInfo = `🔄 Normalleştirme: dil=${effectiveLang} | sözdizimi=${effectiveSyntax}\n`;
    } catch (e) {
      // Normalizer bulunamazsa devam et
    }
  }

  showOutput('⏳ ' + (andRun ? 'Derleniyor ve çalıştırılıyor...' : 'Derleniyor...') + '\n');
  if (normInfo) appendOutput(normInfo);
  setStatus('⏳ Çalışıyor...');

  let json;
  try {
    json = await backend.compile(code, andRun);
  } catch (err) {
    appendOutput('❌ Derleme hatası: ' + err.message + '\n');
    setStatus('❌ Hata');
    return;
  }

  if (json.stderr) appendOutput(json.stderr + '\n');
  if (json.stdout) appendOutput(json.stdout);
  if (!json.stderr && !json.stdout) appendOutput('(çıktı yok)\n');

  const ok = json.exitCode === 0;
  setStatus(ok ? '✅ Başarılı' : '❌ Derleme hatası');
}

// ── Çıktı paneli ───────────────────────────────────────────────────────────
function showOutput(text) {
  outputEl.classList.remove('hidden');
  $('output-content').textContent = text;
}

function appendOutput(text) {
  outputEl.classList.remove('hidden');
  $('output-content').textContent += text;
}

// ── Status bar ─────────────────────────────────────────────────────────────
function setStatus(msg) {
  statusText.textContent = msg;
}

function updateCursorInfo() {
  if (!state.editor) return;
  const pos  = state.editor.view.state.selection.main.head;
  const line = state.editor.view.state.doc.lineAt(pos);
  cursorInfo.textContent = `Sat ${line.number}, Sut ${pos - line.from + 1}`;
}

// ── Renk paleti ──────────────────────────────────────────────────────────
const PALETTE_CLASSES = ['light', 'dracula', 'monokai', 'nord', 'solarized', 'pink', 'blue-kids', 'purple', 'magenta', 'fuchsia', 'cyan'];
function applyPalette(theme) {
  document.body.classList.remove(...PALETTE_CLASSES);
  if (theme) document.body.classList.add(theme);
  localStorage.setItem('melp-theme', theme);
  document.querySelectorAll('.palette-item').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
  if (state.editor) MelpEditor.setEditorTheme(state.editor.view, theme);
}

const FONT_SIZE_MAP = { 'S': '12px', 'M': '14px', 'L': '17px', 'XL': '21px' };
function applyFontSize(sizeKey) {
  localStorage.setItem('melp-font-size', sizeKey);
  document.querySelectorAll('.font-size-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.size === sizeKey);
  });
  if (state.editor) MelpEditor.setEditorFontSize(state.editor.view, FONT_SIZE_MAP[sizeKey] || '14px');
}

// ── Başlangıç ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initEditor();
  loadExamplesPanel();
  setStatus('MELP IDE — Hazır');
  updateCursorInfo();

  // Dosya çift tıklamayla açıldıysa: ?open=dosya.mlp
  const urlParams = new URLSearchParams(window.location.search);
  const openName  = urlParams.get('open');
  if (openName) {
    fetch('tmp_open.mlp?t=' + Date.now())
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(content => {
        // Başlangıçta açılan boş untitled sekmeyi kapat
        if (state.tabs.length === 1 && !state.tabs[0].modified &&
            state.tabs[0].content.trim() === DEFAULT_CONTENT.trim()) {
          state.tabs = [];
          state.activeTab = null;
        }
        openTab(openName, content);
        history.replaceState(null, '', '/');
      })
      .catch(() => setStatus('Dosya açılamadı: ' + openName));
  }

  // Buton bağlamaları
  $('btn-new').addEventListener('click', newFile);
  $('btn-open').addEventListener('click', openFileFromDisk);
  $('btn-save').addEventListener('click', saveFile);
  $('btn-compile').addEventListener('click', () => compile(false));
  $('btn-run').addEventListener('click', () => compile(true));
  $('btn-close-output').addEventListener('click', () => $('output-panel').classList.add('hidden'));

  // Klavye kısayolları
  document.addEventListener('keydown', async (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 's')  { e.preventDefault(); saveFile(); }
    if (ctrl && e.key === 'n')  { e.preventDefault(); newFile(); }
    if (ctrl && e.key === 'o')  { e.preventDefault(); openFileFromDisk(); }
    if (e.key  === 'F5')        { e.preventDefault(); await compile(true); }
    if (ctrl && e.key === 'b')  { e.preventDefault(); await compile(false); }
    if (e.key  === 'Escape')    { $('output-panel').classList.add('hidden'); }
  });

  // Görünüm popup
  $('appearance-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('appearance-popup').classList.toggle('open');
  });
  document.addEventListener('click', () => $('appearance-popup').classList.remove('open'));
  document.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      applyPalette(el.dataset.theme);
    });
  });
  document.querySelectorAll('.font-size-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      applyFontSize(el.dataset.size);
    });
  });
  applyPalette(localStorage.getItem('melp-theme') || '');
  applyFontSize(localStorage.getItem('melp-font-size') || 'M');

  // Dil & Sözdizimi seçicileri
  const langSel   = $('sel-lang');
  const syntaxSel = $('sel-syntax');

  try {
    // Seçenekleri normalize modülünden doldur
    MelpEditor.getLanguageOptions().forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.name;
      langSel.appendChild(opt);
    });
    MelpEditor.getSyntaxOptions().forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.name;
      syntaxSel.appendChild(opt);
    });
  } catch(e) { /* normalizer yüklenmezse statik listeler kalacak */ }

  langSel.value   = state.lang;
  syntaxSel.value = state.syntax;

  langSel.addEventListener('change', () => {
    state.lang = langSel.value;
    localStorage.setItem('melp-lang', state.lang);
    updateDirectivesInEditor();
  });
  syntaxSel.addEventListener('change', () => {
    state.syntax = syntaxSel.value;
    localStorage.setItem('melp-syntax', state.syntax);
    updateDirectivesInEditor();
  });

  // Başlangıçta kaydedilmiş özel haritaları uygula
  applyAllSavedCustomMaps();

  // ── Dil Düzenle modali ───────────────────────────────────────────────
  const langEditBtn    = $('btn-lang-edit');
  const modalOverlay   = $('lang-modal-overlay');
  const modalClose     = $('btn-lang-modal-close');
  const modalSave      = $('btn-lang-modal-save');
  const modalCancel    = $('btn-lang-modal-cancel');
  const modalTitle     = $('lang-modal-title');
  const customTextarea = $('custom-map-textarea');

  function openLangModal() {
    const lang = state.lang;
    modalTitle.textContent = 'Dili Özelleştir — ' + (langSel.options[langSel.selectedIndex]?.text || lang);
    customTextarea.value = buildDisplayText(lang);
    // English için: textarea salt okunur, Kaydet gizli
    const isCanonical = (lang === 'english');
    customTextarea.readOnly = isCanonical;
    customTextarea.style.opacity = isCanonical ? '0.55' : '1';
    if (modalSave) modalSave.style.display = isCanonical ? 'none' : '';
    modalOverlay.classList.remove('hidden');
    customTextarea.focus();
  }

  function closeLangModal() { modalOverlay.classList.add('hidden'); }

  if (langEditBtn) langEditBtn.addEventListener('click', openLangModal);
  if (modalClose)  modalClose.addEventListener('click',  closeLangModal);
  if (modalCancel) modalCancel.addEventListener('click', closeLangModal);
  modalOverlay?.addEventListener('click', (e) => { if (e.target === modalOverlay) closeLangModal(); });

  if (modalSave) {
    modalSave.addEventListener('click', () => {
      const lang = state.lang;
      const text = customTextarea.value.trim();
      // Bilinmeyen canonical → o satırı atla, orijinal korunur
      const knownCanonicals = new Set();
      try {
        const defs = MelpEditor.getDefaultKeywords ? MelpEditor.getDefaultKeywords(lang) : {};
        Object.values(defs).forEach(v => knownCanonicals.add(v));
      } catch(e) {}
      // Geçerli satırları filtrele (her iki taraf dolu + canonical tanımlı)
      const validLines = [];
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('--')) continue;
        const eq = t.indexOf('=');
        if (eq < 1) continue;
        const canonical = t.slice(0, eq).trim();
        const alias     = t.slice(eq + 1).trim();
        if (!canonical || !alias) continue;                          // print = (boş) → atla
        if (knownCanonicals.size && !knownCanonicals.has(canonical)) continue; // prin = yaz → atla
        validLines.push(`${canonical} = ${alias}`);
      }
      if (validLines.length) {
        localStorage.setItem('melp-custom-map-' + lang, validLines.join('\n'));
      } else {
        localStorage.removeItem('melp-custom-map-' + lang);
      }
      applyCustomKeywords(lang);
      closeLangModal();
      setStatus('✅ Keyword haritası kaydedildi: ' + lang);
    });
  }
});
