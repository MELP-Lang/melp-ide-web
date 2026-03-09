// MELP Web Editörü — app-web.js
// Electron bağımlılıkları kaldırıldı; tarayıcı File API + fetch kullanır
'use strict';

// ── Backend URL yapılandırması ─────────────────────────────────────────────
// index.html'deki window.MELP_API_URL ayarından gelir (Railway, Render, vb.)
const API_URL = (typeof window.MELP_API_URL !== 'undefined' && window.MELP_API_URL)
  ? window.MELP_API_URL.replace(/\/$/, '')
  : '';  // Boşsa aynı origin (local dev veya backend aynı sunucuda)

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
// Railway modu: fetch → POST /api/compile
// WASM modu: wasmBackend (tarayıcı içi, Railway gerektirmez)
// Geçiş için sadece aktif satırı değiştir.
const backend = {
  async compile(code, run) {
    // ── WASM modu (tarayıcı içi derleme, Railway gerektirmez) ────────────
    return wasmBackend.compile(code, run);

    // ── Railway / sunucu modu (yedek, WASM çalışmazsa uncomment yap) ─────
    // const res  = await fetch(API_URL + '/api/compile', {
    //   method:  'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body:    JSON.stringify({ code, run }),
    // });
    // return res.json();  // { stdout, stderr, exitCode }
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
  activeTab:  null,
};

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const editorEl   = $('editor-container');
const tabsEl     = $('tabs');
const statusText = $('status-text');
const cursorInfo = $('cursor-info');
const outputEl   = $('output-panel');

// ── Editör başlat ──────────────────────────────────────────────────────────
const DEFAULT_CONTENT =
`-- Merhaba, MELP!
function main()
    print("Merhaba, Dünya!")
end_function
`;

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
  openTab(null, '');
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
];

function loadExamplesPanel() {
  const container = $('examples-list');
  if (!container) return;
  EXAMPLES.forEach(ex => {
    const el = document.createElement('div');
    el.className  = 'tree-file';
    el.textContent = ex.label;
    el.title = ex.label + '.mlp';
    el.addEventListener('click', () => {
      openTab(ex.label + '.mlp', ex.code);
    });
    container.appendChild(el);
  });
}

// ── Derleme & çalıştırma ───────────────────────────────────────────────────
async function compile(andRun = false) {
  const code = state.editor.getValue();

  showOutput('⏳ ' + (andRun ? 'Derleniyor ve çalıştırılıyor...' : 'Derleniyor...') + '\n');
  setStatus('⏳ Çalışıyor...');

  let json;
  try {
    json = await backend.compile(code, andRun);
  } catch (err) {
    appendOutput('❌ Backend bağlantı hatası: ' + err.message + '\n');
    appendOutput('\nBackend URL: ' + (API_URL || '(aynı origin)') + '\n');
    appendOutput('index.html içindeki window.MELP_API_URL değerini kontrol edin.\n');
    setStatus('❌ Bağlantı hatası');
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

// ── Klavye kısayolları ─────────────────────────────────────────────────────
document.addEventListener('keydown', async (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 's')  { e.preventDefault(); saveFile(); }
  if (ctrl && e.key === 'n')  { e.preventDefault(); newFile(); }
  if (ctrl && e.key === 'o')  { e.preventDefault(); openFileFromDisk(); }
  if (e.key  === 'F5')        { e.preventDefault(); await compile(true); }
  if (ctrl && e.key === 'b')  { e.preventDefault(); await compile(false); }
  if (e.key  === 'Escape')    { $('output-panel').classList.add('hidden'); }
});

// ── Buton bağlamaları ──────────────────────────────────────────────────────
$('btn-new').addEventListener('click', newFile);
$('btn-open').addEventListener('click', openFileFromDisk);
$('btn-save').addEventListener('click', saveFile);
$('btn-compile').addEventListener('click', () => compile(false));
$('btn-run').addEventListener('click', () => compile(true));
$('btn-close-output').addEventListener('click', () => $('output-panel').classList.add('hidden'));
// ── Renk paleti ──────────────────────────────────────────────────────────
const PALETTE_CLASSES = ['light', 'dracula', 'monokai', 'nord', 'solarized'];
function applyPalette(theme) {
  document.body.classList.remove(...PALETTE_CLASSES);
  if (theme) document.body.classList.add(theme);
  localStorage.setItem('melp-theme', theme);
  document.querySelectorAll('.palette-item').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
}
$('palette-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('palette-popup').classList.toggle('open');
});
document.addEventListener('click', () => $('palette-popup').classList.remove('open'));
document.querySelectorAll('.palette-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    applyPalette(el.dataset.theme);
    $('palette-popup').classList.remove('open');
  });
});
applyPalette(localStorage.getItem('melp-theme') || '');

// ── Başlangıç ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initEditor();
  loadExamplesPanel();
  setStatus('MELP IDE — Hazır');
  updateCursorInfo();
});
