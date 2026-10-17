# Generates the Signiv logo options (SVG, text converted to outlines).
# Run: python3 -I build.py
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

F = '/home/claude/fonts/'
INK, INK2, PURPLE, PURPLE_D, LAV, PALE, GREEN = '#191432', '#231b42', '#5b45d6', '#3a2b8f', '#a699eb', '#eae3fd', '#12a06c'
OUT = os.path.dirname(os.path.abspath(__file__))


_cache = {}


def load(font, wght):
    k = (font, wght)
    if k not in _cache:
        from fontTools.varLib import instancer
        f = TTFont(F + font)
        if wght and 'fvar' in f:
            f = instancer.instantiateVariableFont(f, {'wght': wght})
        _cache[k] = f
    return _cache[k]


def text_path(font, text, size, x, base, track=0.0, wght=None, nodot_at=None):
    """Outline `text`. Returns (path, advance, [(cx, stem_top)] for glyph indexes in nodot_at)."""
    from fontTools.pens.recordingPen import RecordingPen
    f = load(font, wght)
    gs, cmap, upm = f.getGlyphSet(), f.getBestCmap(), f['head'].unitsPerEm
    s = size / upm
    d, cx, marks = [], x, {}
    for n, ch in enumerate(text):
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (s, 0, 0, -s, cx, base))
        if nodot_at is not None and n == nodot_at:
            rec = RecordingPen()
            gs[g].draw(rec)
            contours, cur = [], []
            for op, args in rec.value:
                cur.append((op, args))
                if op in ('closePath', 'endPath'):
                    contours.append(cur)
                    cur = []
            def top(c):
                return max(p[1] for op, a in c for p in a if p is not None)
            contours.sort(key=top)
            keep = contours[0]
            for op, a in keep:
                getattr(tp, op)(*a)
            marks['dot'] = (cx + f['hmtx'][g][0] * s / 2, base - top(contours[1]) * s)
            marks['stem_top'] = base - top(keep) * s
        else:
            gs[g].draw(tp)
        d.append(pen.getCommands())
        cx += f['hmtx'][g][0] * s + track * size
    return ' '.join(d), cx - x - track * size, marks


def svg(w, h, body, defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{"<defs>"+defs+"</defs>" if defs else ""}{body}</svg>\n'


GRAD = f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{PURPLE}"/><stop offset="1" stop-color="{PURPLE_D}"/></linearGradient>'
GRAD_I = f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2152"/><stop offset="1" stop-color="{INK}"/></linearGradient>'
CHECK = 'M-9 0.5 L-3 6.5 L9 -6'


# ---------- icons (120 x 120) ----------
def icon_a():  # pen-stroke S
    body = ('<rect width="120" height="120" rx="30" fill="url(#g)"/>'
            '<path d="M84 38 C72 24 38 26 38 46 C38 66 82 56 82 76 C82 96 46 98 34 82" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="90" cy="90" r="11" fill="{GREEN}" stroke="url(#g)" stroke-width="4"/>'
            f'<path d="{CHECK}" transform="translate(90 90) scale(.6)" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
    return body, GRAD


def icon_b():  # document with signature and check
    body = ('<rect width="120" height="120" rx="30" fill="url(#g)"/>'
            f'<path d="M38 26 H66 L84 44 V88 a6 6 0 0 1 -6 6 H38 a6 6 0 0 1 -6 -6 V32 a6 6 0 0 1 6 -6 Z" fill="{PALE}"/>'
            f'<path d="M66 26 V38 a6 6 0 0 0 6 6 H84 Z" fill="{LAV}"/>'
            f'<rect x="41" y="52" width="26" height="4.5" rx="2.25" fill="{LAV}"/>'
            f'<path d="M41 80 C46 66 50 66 50 76 C50 84 55 72 59 72 C63 72 61 82 70 74" fill="none" stroke="{PURPLE}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="86" cy="86" r="17" fill="{GREEN}" stroke="{PURPLE_D}" stroke-width="5"/>'
            f'<path d="{CHECK}" transform="translate(86 86) scale(.85)" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
    return body, GRAD


def icon_c():  # S from two stacked ribbons (echoes the stacked-pages icon of the reference)
    body = ('<rect width="120" height="120" rx="30" fill="url(#g)"/>'
            '<path d="M84 26 H54 A17 17 0 0 0 54 60" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/>'
            f'<path d="M54 60 H66 A17 17 0 0 1 66 94 H36" fill="none" stroke="{LAV}" stroke-width="13" stroke-linecap="round"/>'
            f'<circle cx="90" cy="94" r="7" fill="{GREEN}"/>')
    return body, GRAD


def icon_d():  # the "i" whose dot is the check
    body = ('<rect width="120" height="120" rx="30" fill="url(#g)"/>'
            '<rect x="49" y="52" width="22" height="46" rx="11" fill="#fff"/>'
            f'<circle cx="60" cy="31" r="14" fill="{GREEN}"/>'
            f'<path d="{CHECK}" transform="translate(60 31) scale(.85)" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
    return body, GRAD_I.replace(INK, PURPLE_D) if False else GRAD


OPTIONS = [
    ('a', 'סימן S בקו עט', icon_a, 'Plus_Jakarta_Sans/plus-jakarta-sans-800-latin.woff2', 800, 'signiv'),
    ('b', 'מסמך עם חתימה ו-V', icon_b, 'Manrope/manrope-800-latin.woff2', 800, 'signiv'),
    ('c', 'S משני סרטים', icon_c, 'Outfit/outfit-700-latin.woff2', 700, 'signiv'),
    ('d', 'האות i עם וי', icon_d, 'Poppins/poppins-600.woff2', None, 'signiv'),
]


def lockup(icon, font, wght, dark_bg, pad=24, check_i=False):
    body_i, defs = icon()
    size, gap = 84, 30
    f = load(font, wght)
    xh = f['OS/2'].sxHeight / f['head'].unitsPerEm * size
    base = pad + 60 + xh / 2          # x-height centred on the icon
    x0 = pad + 120 + gap
    tcol = '#fff' if dark_bg else INK
    d, adv, marks = text_path(font, 'signiv', size, x0, base, -0.015, wght, nodot_at=4 if check_i else None)
    extra = ''
    if check_i:
        cx, top = marks['dot']
        r = size * 0.13
        cy = marks['stem_top'] - r * 1.9
        extra = (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{GREEN}"/>'
                 f'<path d="{CHECK}" transform="translate({cx:.1f} {cy:.1f}) scale({r/13:.3f})" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
    body = f'<g transform="translate({pad} {pad})">{body_i}</g><path d="{d}" fill="{tcol}"/>{extra}'
    return svg(round(x0 + adv + pad), 120 + 2 * pad, body, defs)


for key, name, icon, font, wght, text in OPTIONS:
    b, defs = icon()
    with open(f'{OUT}/option-{key}-icon.svg', 'w') as fh:
        fh.write(svg(120, 120, b, defs))
    for dark in (True, False):
        with open(f'{OUT}/option-{key}-logo-{"dark" if dark else "light"}.svg', 'w') as fh:
            fh.write(lockup(icon, font, wght, dark, check_i=(key == 'd')))
print('ok')
