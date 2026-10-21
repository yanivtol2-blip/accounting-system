#!/usr/bin/env bash
# Puts the narration and the music under the two silent renders.
#   1. cd ../_tools && ELEVENLABS_API_KEY=... node tts.js --lines ../signiv-mobile-signing/narration.json --voice EXAVITQu4vr4xnSDxMaL --model eleven_v4 --speed 1.1
#   2. node vo-timing.js --lines ../signiv-mobile-signing/narration.json --breath 400   (writes timing.js)
#   3. render both silent versions with render.js (see summary.md)
#   4. bash ../signiv-mobile-signing/mix.sh                                      (from _tools)
# Music: "Motivating Mornings" by Mixkit, Mixkit Free License (not committed: the licence forbids passing the file on).
set -euo pipefail
cd "$(dirname "$0")"
TOOLS=../_tools/out
MUSIC_URL=https://assets.mixkit.co/music/759/759.mp3
MUSIC=$TOOLS/music-759.mp3
[ -f "$MUSIC" ] || curl -sL -A "Mozilla/5.0" -o "$MUSIC" "$MUSIC_URL"

# where each clip starts, and the video length, from timing.js
read -r DUR DELAYS < <(node -e '
  const w = {}; new Function("window", require("fs").readFileSync("timing.js", "utf8"))(w);
  console.log(w.VDUR / 1000, w.VO.map((v) => v.at).join(","));')
IFS=, read -ra AT <<< "$DELAYS"

# 1. the voice track: every clip at its place, loudness -16 LUFS
inputs=(); graph=""; labels=""
for i in "${!AT[@]}"; do
  inputs+=(-i "$TOOLS/vo-$((i + 1)).mp3")
  graph+="[$i:a]aresample=48000,aformat=channel_layouts=mono,adelay=${AT[$i]}:all=1[v$i];"
  labels+="[v$i]"
done
ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex \
  "${graph}${labels}amix=inputs=${#AT[@]}:normalize=0,apad=whole_dur=${DUR},loudnorm=I=-16:TP=-2:LRA=11[o]" \
  -map "[o]" -ar 48000 "$TOOLS/vo.wav"

# 2. music bed at -31 LUFS, faded, ducked a little more while she speaks; the sum to -14 LUFS for social feeds
ffmpeg -hide_banner -loglevel error -y -i "$TOOLS/vo.wav" -i "$MUSIC" -filter_complex "
  [1:a]atrim=0:${DUR},asetpts=PTS-STARTPTS,aresample=48000,loudnorm=I=-31:TP=-6,
       afade=t=in:d=0.6,afade=t=out:st=$(echo "$DUR - 2.5" | bc):d=2.5[m];
  [0:a]asplit[vo][key];
  [key]aformat=channel_layouts=stereo[k];
  [m][k]sidechaincompress=threshold=0.03:ratio=4:attack=60:release=450[md];
  [vo]aformat=channel_layouts=stereo[vs];
  [vs][md]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9[o]" \
  -map "[o]" -ar 48000 "$TOOLS/mix.wav"

# 3. under both versions
for v in vertical landscape; do
  ffmpeg -hide_banner -loglevel error -y -i "signiv-mobile-signing-$v.mp4" -i "$TOOLS/mix.wav" \
    -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "signiv-mobile-signing-$v-voice.mp4"
  echo "MIXED: signiv-mobile-signing-$v-voice.mp4"
done
ffmpeg -hide_banner -i "$TOOLS/mix.wav" -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary/,$p' | grep -E 'I:|Peak:'
