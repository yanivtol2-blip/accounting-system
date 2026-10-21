#!/usr/bin/env node
// Renders a code-drawn video page frame by frame.
// The page contract: window.DUR (ms), window.seek(ms), window.ready (promise), window.geomWarnings.
//
//   node render.js --page ../<name>/X.html --size 1080x1920 --preview 1600,3400      -> out/preview-<size>-<ms>.png
//   node render.js --page ../<name>/X.html --size 1920x1080 --fps 30 --o ../<name>/<name>.mp4
//   node render.js --o ../<name>/<name>.mp4 --verify --at 1,4,7                        -> out/verify-<s>.png + specs
//
// store/videos is served over loopback (file:// blocks woff2); any file the page asks for and
// does not get is printed as MISSING:.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = next; i++; }
}

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

if (args.verify) { verify(); process.exit(0); }

const [W, H] = String(args.size || '1080x1920').split('x').map(Number);
const FPS = Number(args.fps || 30);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        console.log('MISSING:', req.url);
        res.writeHead(404); return res.end();
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function main() {
  const puppeteer = require('puppeteer-core');
  const srv = await serve();
  const pagePath = path.relative(ROOT, path.resolve(__dirname, args.page));
  const url = `http://127.0.0.1:${srv.address().port}/${pagePath.split(path.sep).join('/')}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (m) => console.log('PAGE:', m.text()));
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DUR);
  for (const w of await page.evaluate(() => window.geomWarnings || [])) console.log('GEOMETRY:', w);

  if (args.preview) {
    for (const ms of String(args.preview).split(',').map(Number)) {
      await page.evaluate((t) => window.seek(t), ms);
      const file = path.join(OUT, `preview-${W}x${H}-${ms}.png`);
      await page.screenshot({ path: file });
      console.log('PREVIEW:', file);
    }
  } else {
    const out = path.resolve(__dirname, args.o);
    const frames = Math.round((dur / 1000) * FPS);
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.seek(t), (f * 1000) / FPS);
      const buf = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % (FPS * 5) === 0) console.log(`frame ${f}/${frames} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('RENDERED:', out, `${frames} frames`);
  }
  await browser.close();
  srv.close();
}

function verify() {
  const file = path.resolve(__dirname, args.o);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_frames:format=duration', '-of', 'default=nw=1', file]).toString();
  console.log(probe.trim());
  for (const s of String(args.at || '1').split(',')) {
    const png = path.join(OUT, `verify-${path.basename(file, '.mp4')}-${s}.png`);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', s, '-i', file, '-frames:v', '1', png]);
    console.log('FRAME:', png);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
