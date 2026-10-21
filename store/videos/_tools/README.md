# Video kit

Shared by every video in `store/videos`. Never copied into a video's folder.

```bash
npm ci                       # puppeteer-core; uses the system Chrome (CHROME=...) and ffmpeg (FFMPEG=...)
node render.js --page ../<name>/<name>.html --size 1080x1920 --preview 1600,3400     # stills -> out/
node render.js --page ../<name>/<name>.html --size 1920x1080 --fps 30 --o ../<name>/<name>.mp4
node render.js --o ../<name>/<name>.mp4 --verify --at 1,4,7                          # specs + frames back out of the MP4
```

The page contract: `window.DUR` (ms), `window.seek(ms)` sets every animated value from `t` alone,
`window.ready` resolves when fonts and images are decoded, `window.geomWarnings` is printed as
`GEOMETRY:`. No CSS transitions or animations. Fonts from `fonts/` by relative URL
(`../_tools/fonts/heebo-hebrew-var.woff2`); `store/videos` is served over loopback and any
file the page asks for and does not get is printed as `MISSING:`.
