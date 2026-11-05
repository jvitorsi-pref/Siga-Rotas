import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import { resolve } from 'node:path';
const read = p => readFileSync(process.env.SIGA_PWA_ROOT ? resolve(process.env.SIGA_PWA_ROOT, p) : new URL('../' + p, import.meta.url));
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const apk = JSON.parse(read('APK/app.json')).expo;
const sw = read('public/sw.js').toString();
const icons = [...manifest.icons.map(i => '/' + i.src), '/icons/apple-touch-icon.png'];

// PNGs Canvas, RGB/RGBA de 8 bits sem entrelaçamento; valida pixels reais.
function png(path) {
  const bytes = read('public' + path);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8); assert.equal(bytes[28], 0);
  const bpp = ({ 2: 3, 6: 4 })[bytes[25]]; assert.ok(bpp);
  const chunks = [];
  for (let pos = 8; pos < bytes.length;) {
    const size = bytes.readUInt32BE(pos), type = bytes.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(pos + 8, pos + 8 + size));
    pos += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * bpp;
  assert.equal(raw.length, (stride + 1) * height);
  const pixels = Buffer.alloc(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const idx = y * stride + x, a = x >= bpp ? pixels[idx - bpp] : 0, b = y ? pixels[idx - stride] : 0, c = y && x >= bpp ? pixels[idx - stride - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predict = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[idx] = (raw[y * (stride + 1) + x + 1] + predict) & 255;
    }
  }
  return { width, height, bpp, pixels };
}

test('PWA: identidade e tema seguem APK, sem promessa de cálculo Web offline', () => {
  assert.equal(manifest.name, apk.name); assert.equal(manifest.short_name, 'SIGA-Rotas');
  assert.equal(manifest.background_color, apk.backgroundColor); assert.equal(manifest.theme_color, apk.primaryColor);
  assert.match(manifest.description, /cálculo no Web exige acesso à API/);
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
});
test('PWA: manifesto aponta para PNGs reais em 192/512 e maskable separado', () => {
  for (const [size, purpose] of [[192, 'any'], [512, 'any'], [512, 'maskable']]) {
    const icon = manifest.icons.find(i => i.sizes === `${size}x${size}` && i.purpose === purpose);
    assert.ok(icon); assert.equal(icon.type, 'image/png');
    const image = png('/' + icon.src); assert.equal(image.width, size); assert.equal(image.height, size);
  }
});
test('PWA: PNGs são opacos, não vazios e máscara não corta a arte no círculo seguro', () => {
  for (const path of icons) {
    const { width, height, bpp, pixels } = png(path); let colored = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = (y * width + x) * bpp;
      if (bpp === 4) assert.equal(pixels[p + 3], 255);
      const white = pixels[p] === 255 && pixels[p + 1] === 255 && pixels[p + 2] === 255;
      if (!white) colored++;
      if (path.includes('maskable') && Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) > width * 0.4) assert.ok(white, `${x},${y} fora da área segura`);
    }
    assert.ok(colored > width * height * 0.005); assert.equal(pixels[0], 255);
  }
});
test('PWA: favicon e apple-touch-icon referenciam arquivos existentes da identidade comum', () => {
  const html = read('public/index.html').toString();
  assert.match(html, /rel="icon"[^>]*href="icons\/icon-192.png"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="icons\/apple-touch-icon.png"/);
  const image = png('/icons/apple-touch-icon.png'); assert.equal(image.width, 180); assert.equal(image.height, 180);
});
test('PWA: geração parte do logotipo original do APK, que permanece idêntico ao Web', () => {
  assert.deepEqual(read('APK/assets/logo-siga-app.png'), read('public/logo-siga-app.png'));
  const source = read('tools/gerar-icones-pwa.mjs').toString(); assert.match(source, /APK\/assets\/logo-siga-app\.png/);
  assert.match(source, /ctx\.drawImage\(image/);
});
function worker() {
  const handlers = {}, stored = new Map(), added = [];
  const path = r => new URL(typeof r === 'string' ? r : r.url, 'https://siga.test').pathname;
  vm.runInNewContext(sw, {
    self: { location: { origin: 'https://siga.test' }, addEventListener: (n, fn) => { handlers[n] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => ({ add: async req => {
      const p = path(req); added.push(p); stored.set(p, new Response(icons.includes(p) ? read('public' + p) : 'shell'));
    }, match: async req => stored.get(path(req))?.clone(), put: async () => {} }) },
    Request: class { constructor(url) { this.url = new URL(url, 'https://siga.test').href; } },
    URL, fetch: async () => { throw new Error('offline'); },
  });
  return { handlers, added };
}
async function install(w) { let pending; w.handlers.install({ waitUntil: p => { pending = p; } }); await pending; }
test('PWA: instalação do worker inclui manifesto, todos os ícones e módulos comuns', async () => {
  const w = worker(); await install(w);
  for (const p of [...icons, '/manifest.webmanifest', '/resumoRota.js']) assert.ok(w.added.includes(p), p);
});
test('PWA: worker entrega bytes dos ícones do cache quando a rede falha', async () => {
  const w = worker(); await install(w);
  for (const p of icons) {
    let response; w.handlers.fetch({ request: { url: 'https://siga.test' + p, method: 'GET' }, respondWith: promise => { response = promise; } });
    assert.deepEqual(Buffer.from(await (await response).arrayBuffer()), read('public' + p));
  }
});
test('PWA: worker não intercepta API, POST ou recursos externos', () => {
  const w = worker();
  for (const [url, method] of [['https://siga.test/api/rota-paradas', 'GET'], ['https://siga.test/api/rota-paradas', 'POST'], ['https://outro.test/icon.png', 'GET']]) {
    w.handlers.fetch({ request: { url, method }, respondWith: () => assert.fail('Não deve interceptar dados/API') });
  }
});
