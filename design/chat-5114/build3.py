# Round 3: the chosen direction (version 3, pen signing the document), polished, with the full kit.
# Run: python3 build3.py   (output goes to ./final)
import os
from build import load, text_path, svg, OUT

FINAL = os.path.join(OUT, 'final')
G1, G2 = '#3b82f6', '#1c3fb5'
DOC, FOLD, SIGN, PEN, INK = '#f1f6ff', '#a9c6ff', '#1d4ed8', '#22c55e', '#0f1f4d'
LATIN = ('Plus_Jakarta_Sans/plus-jakarta-sans-800-latin.woff2', 300)
HEB = ('Heebo/heebo-300-hebrew.woff2', 300)

DOC_D = 'M38 26 H66 L84 44 V88 a6 6 0 0 1 -6 6 H38 a6 6 0 0 1 -6 -6 V32 a6 6 0 0 1 6 -6 Z'
FOLD_D = 'M66 26 V38 a6 6 0 0 0 6 6 H84 Z'
SIGN_D = 'M40 83 C44 69 49 67 49 76 C49 85 54 73 58 73 C62 73 61 84 68 81'


def icon(variant='color', bg=None, fg=None, tiny=False):
    """variant: color | mono (bg and fg given). tiny drops the fine details for favicons."""
    if variant == 'color':
        gdef = (f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{G1}"/>'
                f'<stop offset="1" stop-color="{G2}"/></linearGradient>'
                f'<linearGradient id="p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4ade80"/>'
                f'<stop offset="1" stop-color="#16a34a"/></linearGradient>')
        back, doc, fold, sign, line, pen, pen_edge, nib, nib_tip = 'url(#g)', DOC, FOLD, SIGN, FOLD, 'url(#p)', G2, '#fff', INK
    else:
        gdef = ''
        back, doc, fold, sign, line, pen, pen_edge, nib, nib_tip = bg, fg, bg, bg, bg, fg, bg, fg, bg
    parts = [f'<rect width="120" height="120" rx="30" fill="{back}"/>',
             f'<path d="{DOC_D}" fill="{doc}"/>',
             f'<path d="{FOLD_D}" fill="{fold}"{" opacity=\".55\"" if variant != "color" else ""}/>']
    if not tiny:
        parts += [f'<rect x="41" y="51" width="26" height="4.5" rx="2.25" fill="{line}"{" opacity=\".55\"" if variant != "color" else ""}/>',
                  f'<path d="{SIGN_D}" fill="none" stroke="{sign}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>']
    parts.append(f'<g transform="translate(68 81) rotate(38)">'
                 f'<rect x="-6" y="-46" width="12" height="36" rx="3.5" fill="{pen}" stroke="{pen_edge}" stroke-width="3"/>'
                 f'<rect x="-6" y="-30" width="12" height="4" fill="{nib}" opacity=".35"/>'
                 f'<path d="M-6 -10 L6 -10 L0 3 Z" fill="{nib}" stroke="{pen_edge}" stroke-width="3" stroke-linejoin="round"/>'
                 f'<circle cx="0" cy="-1" r="1.6" fill="{nib_tip}"/></g>')
    return ''.join(parts), gdef


def word(font, text, size, x, base, track, accent_i=None):
    ff, w = font
    d, adv, marks = text_path(ff, text, size, x, base, track, w, nodot_at=accent_i)
    extra = ''
    if accent_i is not None:
        r = marks['stem_w'] * 0.95
        extra = f'<circle cx="{marks["dot"][0]:.1f}" cy="{marks["stem_top"] - r * 1.75:.1f}" r="{r:.1f}" fill="{PEN}"/>'
    return d, adv, extra


def horizontal(ic, font, text, ink, size=84, gap=30, pad=24, rtl=False, accent=True):
    f = load(*font)
    xh = f['OS/2'].sxHeight / f['head'].unitsPerEm * size
    base = pad + 60 + xh / 2
    body_i, defs = ic
    x0 = pad + 120 + gap
    d, adv, extra = word(font, text, size, x0, base, -0.005 if not rtl else 0, 4 if accent and not rtl else None)
    W = round(x0 + adv + pad)
    return svg(W, 120 + 2 * pad, f'<g transform="translate({pad} {pad})">{body_i}</g><path d="{d}" fill="{ink}"/>{extra}', defs)


def stacked(ic, font, text, ink, size=84, gap=26, pad=28, rtl=False, accent=True):
    f = load(*font)
    body_i, defs = ic
    d0, adv, _ = word(font, text, size, 0, 0, -0.005 if not rtl else 0, None)
    W = round(adv + 2 * pad)
    base = pad + 120 + gap + size * 0.72
    x0 = (W - adv) / 2
    d, adv, extra = word(font, text, size, x0, base, -0.005 if not rtl else 0, 4 if accent and not rtl else None)
    H = round(base + size * 0.3 + pad)
    return svg(W, H, f'<g transform="translate({(W-120)/2} {pad})">{body_i}</g><path d="{d}" fill="{ink}"/>{extra}', defs)


def put(name, content):
    with open(os.path.join(FINAL, name), 'w') as fh:
        fh.write(content)


if __name__ == '__main__':
    col = icon()
    put('signiv-icon.svg', svg(120, 120, *col))
    put('signiv-favicon.svg', svg(120, 120, *icon(tiny=True)))
    put('signiv-icon-mono-white.svg', svg(120, 120, *icon('mono', bg='#fff', fg=INK)))
    put('signiv-icon-mono-dark.svg', svg(120, 120, *icon('mono', bg=INK, fg='#fff')))
    for tag, ink in (('light', INK), ('dark', '#fff')):
        put(f'signiv-logo-horizontal-{tag}.svg', horizontal(col, LATIN, 'signiv', ink))
        put(f'signiv-logo-stacked-{tag}.svg', stacked(col, LATIN, 'signiv', ink))
        put(f'signiv-logo-hebrew-{tag}.svg', horizontal(col, HEB, 'בינגיס', ink, size=92, rtl=True, accent=False))
    print('ok')
