// MELP Web Editörü — esbuild paketi
// npm run build   →  dist/ altına 3 dosya üretir
// npm run dev     →  watch modu

const esbuild = require('esbuild');
const path    = require('path');
const fs      = require('fs');

const watch = process.argv.includes('--watch');

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });

function copy(src, dst) {
  fs.copyFileSync(path.join(__dirname, src), path.join(__dirname, 'dist', dst));
}

function copyStatics() {
  copy('index.html',      'index.html');
  copy('src/app-web.js',  'app-web.js');
  // WASM dosyalarını public/wasm/ → dist/wasm/ kopyala
  const wasmSrc = path.join(__dirname, 'public/wasm');
  const wasmDst = path.join(__dirname, 'dist/wasm');
  if (fs.existsSync(wasmSrc)) {
    fs.mkdirSync(wasmDst, { recursive: true });
    for (const f of fs.readdirSync(wasmSrc)) {
      fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDst, f));
    }
    console.log('✅ dist/wasm/ kopyalandı');
  }
  console.log('✅ dist/index.html + dist/app-web.js kopyalandı');
}

const opts = {
  entryPoints: [path.join(__dirname, 'src/entry.js')],
  bundle:      true,
  outfile:     path.join(__dirname, 'dist/editor.bundle.js'),
  format:      'iife',
  globalName:  'MelpEditor',
  platform:    'browser',
  minify:      !watch,
  sourcemap:   watch ? 'inline' : false,
};

if (watch) {
  (async () => {
    const ctx = await esbuild.context({
      ...opts,
      plugins: [{
        name: 'statics',
        setup(build) { build.onEnd(() => copyStatics()); },
      }],
    });
    await ctx.watch();
    console.log('👀 İzleme modunda — değişiklikler anında derleniyor...');
  })();
} else {
  esbuild.buildSync(opts);
  copyStatics();
  console.log('✅ dist/editor.bundle.js oluşturuldu');
}
