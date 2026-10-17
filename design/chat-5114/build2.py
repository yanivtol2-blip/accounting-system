# Round 2: the "document + signature + check" family with a thin wordmark, in several palettes.
# Run: python3 build2.py
import math, os
from build import load, text_path, svg, CHECK, OUT

CHK = f'<path d="{CHECK}" transform="translate({{x}} {{y}}) scale({{s}})" fill="none" stroke="{{c}}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'


def chk(x, y, s, c='#fff'):
    return CHK.format(x=x, y=y, s=s, c=c)


def base(p, shape):
    g = (f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{p["g1"]}"/>'
         f'<stop offset="1" stop-color="{p["g2"]}"/></linearGradient>')
    if shape == 'circle':
        return '<circle cx="60" cy="60" r="60" fill="url(#g)"/>', g
    return '<rect width="120" height="120" rx="30" fill="url(#g)"/>', g


def doc_path(fill, x=32, y=26):
    return f'<path d="M38 26 H66 L84 44 V88 a6 6 0 0 1 -6 6 H38 a6 6 0 0 1 -6 -6 V32 a6 6 0 0 1 6 -6 Z" fill="{fill}"/>'


SIGN = 'M41 80 C46 66 50 66 50 76 C50 84 55 72 59 72 C63 72 61 82 70 74'


def icon_doc(p, shape='squircle'):
    b, g = base(p, shape)
    return (b + doc_path(p['doc']) +
            f'<path d="M66 26 V38 a6 6 0 0 0 6 6 H84 Z" fill="{p["fold"]}"/>'
            f'<rect x="41" y="52" width="26" height="4.5" rx="2.25" fill="{p["fold"]}"/>'
            f'<path d="{SIGN}" fill="none" stroke="{p["sign"]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="86" cy="86" r="17" fill="{p["ok"]}" stroke="{p["ring"]}" stroke-width="5"/>' + chk(86, 86, .85)), g


def icon_line(p, shape='squircle'):  # outline document, matches the thin type
    b, g = base(p, shape)
    return (b +
            '<path d="M38 26 H64 L84 46 V88 a6 6 0 0 1 -6 6 H38 a6 6 0 0 1 -6 -6 V32 a6 6 0 0 1 6 -6 Z" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/>'
            '<path d="M64 26 V40 a6 6 0 0 0 6 6 H84" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<path d="{SIGN}" fill="none" stroke="{p.get("lsign", p["fold"])}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="86" cy="86" r="17" fill="{p["ok"]}" stroke="{p["ring"]}" stroke-width="5"/>' + chk(86, 86, .85)), g


def icon_pen(p, shape='squircle'):  # a pen is signing the page
    b, g = base(p, shape)
    return (b + doc_path(p['doc']) +
            f'<path d="M66 26 V38 a6 6 0 0 0 6 6 H84 Z" fill="{p["fold"]}"/>'
            f'<rect x="41" y="52" width="26" height="4.5" rx="2.25" fill="{p["fold"]}"/>'
            f'<path d="M41 82 C46 68 50 68 50 78 C50 86 55 74 59 74 C62 74 62 82 66 80" fill="none" stroke="{p["sign"]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<g transform="translate(70 80) rotate(38)"><rect x="-5" y="-44" width="10" height="34" rx="3" fill="{p["ok"]}" stroke="{p["ring"]}" stroke-width="3"/>'
            f'<path d="M-5 -10 L5 -10 L0 4 Z" fill="#fff" stroke="{p["ring"]}" stroke-width="3" stroke-linejoin="round"/></g>'), g


def icon_seal(p, shape='squircle'):  # document stamped with a scalloped seal
    b, g = base(p, shape)
    pts = []
    for k in range(24):
        r = 21 if k % 2 == 0 else 17.5
        a = math.pi * 2 * k / 24
        pts.append(f'{86 + r*math.cos(a):.2f},{86 + r*math.sin(a):.2f}')
    return (b + doc_path(p['doc']) +
            f'<path d="M66 26 V38 a6 6 0 0 0 6 6 H84 Z" fill="{p["fold"]}"/>'
            f'<rect x="41" y="52" width="26" height="4.5" rx="2.25" fill="{p["fold"]}"/>'
            f'<path d="{SIGN}" fill="none" stroke="{p["sign"]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<polygon points="{" ".join(pts)}" fill="{p["ok"]}" stroke="{p["ring"]}" stroke-width="4" stroke-linejoin="round"/>' + chk(86, 86, .8, p.get('okfg', '#fff'))), g


def lockup(icon, p, font, wght, dark_bg, track=-0.01, pad=24):
    body_i, defs = icon
    size, gap = 84, 30
    f = load(font, wght)
    xh = f['OS/2'].sxHeight / f['head'].unitsPerEm * size
    base_y = pad + 60 + xh / 2
    x0 = pad + 120 + gap
    d, adv, _ = text_path(font, 'signiv', size, x0, base_y, track, wght)
    col = '#fff' if dark_bg else p['ink']
    body = f'<g transform="translate({pad} {pad})">{body_i}</g><path d="{d}" fill="{col}"/>'
    return svg(round(x0 + adv + pad), 120 + 2 * pad, body, defs)


FONTS = {
    'manrope': ('Manrope/manrope-800-latin.woff2', 200),
    'jakarta': ('Plus_Jakarta_Sans/plus-jakarta-sans-800-latin.woff2', 300),
    'outfit': ('Outfit/outfit-700-latin.woff2', 200),
    'poppins': ('Poppins/poppins-300.woff2', None),
}

PALETTES = {
    'violet':   dict(name='סגול (המקורי)', g1='#5b45d6', g2='#3a2b8f', doc='#eae3fd', fold='#a699eb', sign='#5b45d6', ok='#12a06c', ring='#3a2b8f', ink='#191432', bg='#191432'),
    'ocean':    dict(name='טורקיז ים', g1='#14a3a8', g2='#0b4a6e', doc='#e6fbfb', fold='#8fdde0', sign='#0b6a86', ok='#f5b83d', ring='#0b4a6e', okfg='#4a3200', ink='#08243a', bg='#08243a'),
    'gold':     dict(name='כחול לילה וזהב', g1='#1d3466', g2='#0b1730', doc='#f6f1e4', fold='#e5c77a', sign='#1d3466', ok='#e5b95c', ring='#0b1730', okfg='#3b2a00', ink='#0b1730', bg='#0b1730'),
    'royal':    dict(name='כחול מלכותי', g1='#3b82f6', g2='#1d3fb8', doc='#eef4ff', fold='#a9c6ff', sign='#1d4ed8', ok='#22c55e', ring='#1d3fb8', ink='#0f1f4d', bg='#0f1f4d'),
    'coral':    dict(name='ורוד אלמוג', g1='#f0566f', g2='#8b2fd0', doc='#fff1f4', fold='#f5a9bb', sign='#b3265a', ok='#19c28a', ring='#8b2fd0', ink='#2a1245', bg='#2a1245'),
    'graphite': dict(name='גרפיט ואמרלד', g1='#374151', g2='#111827', lsign='#6ee7b7', doc='#f3f4f6', fold='#9ca3af', sign='#065f46', ok='#10b981', ring='#111827', ink='#111827', bg='#111827'),
}

# key, hebrew name, icon fn, shape, palette, font
VARIANTS = [
    ('1', 'המסמך הקלאסי, גרסה מעודנת', icon_doc, 'squircle', 'violet', 'manrope'),
    ('2', 'מסמך בקווים דקים', icon_line, 'squircle', 'ocean', 'manrope'),
    ('3', 'עט שחותם על המסמך', icon_pen, 'squircle', 'royal', 'jakarta'),
    ('4', 'חותמת אישור על המסמך', icon_seal, 'squircle', 'gold', 'outfit'),
    ('5', 'מסמך בעיגול', icon_doc, 'circle', 'coral', 'manrope'),
    ('6', 'מסמך בקווים, עיגול', icon_line, 'circle', 'graphite', 'jakarta'),
]

if __name__ == '__main__':
    for key, name, fn, shape, pal, font in VARIANTS:
        p = PALETTES[pal]
        ic = fn(p, shape)
        ff, w = FONTS[font]
        with open(f'{OUT}/v2-{key}-icon.svg', 'w') as fh:
            fh.write(svg(120, 120, ic[0], ic[1]))
        for dark in (True, False):
            with open(f'{OUT}/v2-{key}-logo-{"dark" if dark else "light"}.svg', 'w') as fh:
                fh.write(lockup(ic, p, ff, w, dark))
    print('ok')
