# Round 4: the brand kit logos (all variants of the chosen logo). Run: python3 build4.py
import os
from build import svg, load, text_path
import build3 as b3

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'brand', 'logos')
NAVY, WHITE = b3.INK, '#fff'


def put(name, content):
    with open(os.path.join(OUT, name), 'w') as fh:
        fh.write(content)


def wordmark(ink, accent=True, font=b3.LATIN, text='signiv', size=84, pad=16):
    ff, w = font
    f = load(ff, w)
    xh = f['OS/2'].sxHeight / f['head'].unitsPerEm * size
    d, adv, extra = b3.word(font, text, size, pad, pad + size * 0.9, -0.005, 4 if accent else None)
    return svg(round(adv + 2 * pad), round(size * 1.45 + pad), f'<path d="{d}" fill="{ink}"/>{extra}')


def avatar():
    body, defs = b3.icon()
    first = body.index('/>') + 2
    bg = body[:first].replace('rx="30"', 'rx="0"')
    return svg(120, 120, f'{bg}<g transform="translate(12 12) scale(.8)">{body[first:]}</g>', defs)


def banner(w, h, tagline_size, bg_a='#0f1f4d', bg_b='#172f86'):
    """Social share image: stacked lockup centred on a navy gradient with the Hebrew tagline."""
    col = b3.icon()
    body_i, defs = col
    gid = ('<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%s"/>'
           '<stop offset="1" stop-color="%s"/></linearGradient>' % (bg_a, bg_b))
    s = h / 630
    size = 120 * s
    icon_w = 200 * s
    f = load(*b3.LATIN)
    d0, adv, _ = b3.word(b3.LATIN, 'signiv', size, 0, 0, -0.005, None)
    x0 = (w - adv) / 2
    base = h * 0.66
    d, adv, extra = b3.word(b3.LATIN, 'signiv', size, x0, base, -0.005, 4)
    ff, wt = b3.HEB
    tag = 'חתימה דיגיטלית מרחוק'[::-1]
    td0, tadv, _ = text_path(ff, tag, tagline_size, 0, 0, 0.02, wt)
    td, _, _ = text_path(ff, tag, tagline_size, (w - tadv) / 2, base + tagline_size * 1.9, 0.02, wt)
    ic = f'<g transform="translate({(w - icon_w) / 2:.1f} {h * 0.07:.1f}) scale({icon_w / 120:.4f})">{body_i}</g>'
    return svg(w, h, f'<rect width="{w}" height="{h}" fill="url(#bg)"/>{ic}<path d="{d}" fill="#fff"/>{extra}<path d="{td}" fill="#a9c6ff"/>', defs + gid)


if __name__ == '__main__':
    col = b3.icon()
    put('signiv-icon.svg', svg(120, 120, *col))
    put('signiv-favicon.svg', svg(120, 120, *b3.icon(tiny=True)))
    put('signiv-avatar.svg', avatar())
    put('signiv-icon-mono-white.svg', svg(120, 120, *b3.icon('mono', bg='#fff', fg=NAVY)))
    put('signiv-icon-mono-navy.svg', svg(120, 120, *b3.icon('mono', bg=NAVY, fg='#fff')))
    for tag, ink in (('light', NAVY), ('dark', WHITE)):
        put(f'signiv-logo-horizontal-{tag}.svg', b3.horizontal(col, b3.LATIN, 'signiv', ink))
        put(f'signiv-logo-stacked-{tag}.svg', b3.stacked(col, b3.LATIN, 'signiv', ink))
        put(f'signiv-wordmark-{tag}.svg', wordmark(ink))
    # one-colour lockups (print, stamps, fax, embossing)
    put('signiv-logo-mono-navy.svg', b3.horizontal(b3.icon('mono', bg=NAVY, fg='#fff'), b3.LATIN, 'signiv', NAVY, accent=False))
    put('signiv-logo-mono-white.svg', b3.horizontal(b3.icon('mono', bg='#fff', fg=NAVY), b3.LATIN, 'signiv', '#fff', accent=False))
    put('signiv-wordmark-mono-navy.svg', wordmark(NAVY, accent=False))
    put('signiv-wordmark-mono-white.svg', wordmark('#fff', accent=False))
    put('signiv-share-1200x630.svg', banner(1200, 630, 34))
    print('ok')
