#!/usr/bin/env node
// Fits the story to the voice: reads <video>/narration.json and the clips tts.js wrote to out/vo-<n>.mp3,
// stretches each line's window of the story just enough for its speech (+ a breath), and writes
// <video>/timing.js: window.WARP (knots [videoMs, storyMs]) for the page, window.VO (where each clip
// starts in the video) for mix.sh.
//   node vo-timing.js --lines ../<name>/narration.json [--breath 300] [--dur 45000]
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = next; i++; }
}
const linesFile = path.resolve(__dirname, args.lines);
const { lines } = JSON.parse(fs.readFileSync(linesFile, 'utf8'));
const BREATH = Number(args.breath || 300);
const STORY = Number(args.dur || 45000);

// speech start and end inside a clip, from silencedetect (-45 dB)
function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-45dB:d=0.05', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr;
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString()) * 1000;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => m[1] * 1000);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => m[1] * 1000);
  const lead = starts.length && starts[0] < 5 && ends.length ? ends[0] : 0;
  const lastStart = starts[starts.length - 1];
  // a silence that runs to the end of the clip (an mp3 frame or two of padding is still "the end")
  const tail = starts.length > ends.length || (lastStart !== undefined && ends[ends.length - 1] >= dur - 120) ? lastStart : dur;
  return { lead, end: tail, dur };
}

const knots = [[0, 0]];
const vo = [];
let shift = 0;
lines.forEach((l, n) => {
  const file = path.join(__dirname, 'out', `vo-${n + 1}.mp3`);
  const m = measure(file);
  const need = m.end - m.lead + BREATH;
  const room = l.end - l.at;
  const extra = Math.max(0, need - room);
  const at = l.at + shift;
  knots.push([at, l.at]);
  shift += extra;
  knots.push([l.end + shift, l.end]);
  vo.push({ file: `vo-${n + 1}.mp3`, at: Math.round(at - m.lead), speech: Math.round(m.end - m.lead) });
  console.log(`line ${n + 1}: speech ${Math.round(m.end - m.lead)}ms, room ${room}ms${extra ? `, story stretched +${Math.round(extra)}ms` : ''}`);
});
knots.push([STORY + shift, STORY]);
const out = knots.map(([a, b]) => [Math.round(a), b]);
const DUR = out[out.length - 1][0];
const js = `// written by _tools/vo-timing.js from narration.json and the voice clips; do not edit by hand\n`
  + `window.WARP = ${JSON.stringify(out)};\nwindow.VO = ${JSON.stringify(vo)};\nwindow.VDUR = ${DUR};\n`;
fs.writeFileSync(path.join(path.dirname(linesFile), 'timing.js'), js);
console.log(`video length ${DUR}ms (story ${STORY}ms)`);
