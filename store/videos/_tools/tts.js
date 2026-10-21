#!/usr/bin/env node
// Narration with ElevenLabs: one clip per line of <video>/narration.json -> out/vo-<n>.mp3,
// then reports each clip's length against its window.
//   ELEVENLABS_API_KEY=... node tts.js --lines ../<name>/narration.json [--voice <id>] [--model <id>] [--speed 1.0]
//   --only 2 makes one line again (a retake)
//   node tts.js --voices          lists the account's voices (and Hebrew female ones from the library)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = next; i++; }
}
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
const API = 'https://api.elevenlabs.io/v1';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

async function get(p) {
  const r = await fetch(API + p, { headers: { 'xi-api-key': KEY } });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function voices() {
  const mine = await get('/voices');
  for (const v of mine.voices) console.log('VOICE:', v.voice_id, v.name, JSON.stringify(v.labels || {}));
  const lib = await get('/shared-voices?language=he&gender=female&page_size=20');
  for (const v of lib.voices || []) console.log('LIBRARY:', v.public_owner_id, v.voice_id, v.name, v.accent || '', v.use_case || '');
  const models = await get('/models');
  for (const m of models) if ((m.languages || []).some((l) => l.language_id === 'he')) console.log('MODEL (he):', m.model_id, m.name);
}

async function speak() {
  const { lines } = JSON.parse(fs.readFileSync(path.resolve(__dirname, args.lines), 'utf8'));
  const voice = args.voice;
  const model = args.model || 'eleven_v3';
  const speed = Number(args.speed || 1);
  let prev;
  for (let n = 0; n < lines.length; n++) {
    prev = n ? lines[n - 1].text : undefined;
    if (args.only && Number(args.only) !== n + 1) continue;
    const body = { text: lines[n].text, model_id: model, language_code: 'he',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, speed } };
    if (prev) body.previous_text = prev;
    if (lines[n + 1]) body.next_text = lines[n + 1].text;
    const r = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`line ${n + 1}: ${r.status} ${await r.text()}`);
    const file = path.join(OUT, `vo-${n + 1}.mp3`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString()) * 1000;
    const room = lines[n].end - lines[n].at;
    console.log(`${dur <= room ? 'FITS' : 'LONG'}: line ${n + 1} ${Math.round(dur)}ms of ${room}ms`);
  }
}

(args.voices ? voices() : speak()).catch((e) => { console.error(e.message); process.exit(1); });
