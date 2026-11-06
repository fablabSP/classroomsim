"""Prepare the card artwork in art/source/*.png for the app.

Run:  python3 scripts/cards.py   (needs Pillow: pip install pillow)

Fronts: the white surround is made transparent, the card is trimmed and resized,
and the white text panel is measured so text can be placed inside it. The panel
stretches downwards when a card has more text than fits.
Backs: only the emblem (icon + word) is kept as white-on-transparent; the frame is
drawn by CSS in the sampled colours, so a back can match any front's height.
Writes public/cards/*.webp and src/card-art.js (measurements used by the app).
"""
import json, os
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, 'art/source'), os.path.join(ROOT, 'public/cards')
WIDTH = 640  # about 2x the largest on-screen card width, sharp on phones
os.makedirs(OUT, exist_ok=True)


def clear_surround(im, tol=26):
    """Flood-fill the near-white background from the image edges and make it transparent."""
    im = im.convert('RGBA'); w, h = im.size; px = im.load()
    white = lambda p: p[0] > 255 - tol and p[1] > 255 - tol and p[2] > 255 - tol
    seen = bytearray(w * h); q = deque()
    for x in range(w): q.extend([(x, 0), (x, h - 1)])
    for y in range(h): q.extend([(0, y), (w - 1, y)])
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]: continue
        seen[y * w + x] = 1
        p = px[x, y]
        if not white(p): continue
        px[x, y] = (255, 255, 255, 0)
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return im.crop(im.getbbox())


def panel(im):
    """Find the white text panel: the longest near-white run down the centre, then across."""
    w, h = im.size; px = im.load()
    isw = lambda p: p[3] > 200 and min(p[:3]) > 236
    best, run, start = (0, 0), 0, 0
    for x in (w // 2 - w // 8, w // 2, w // 2 + w // 8):
        run = 0
        for y in range(h):
            if isw(px[x, y]):
                if run == 0: start = y
                run += 1
                if run > best[1] - best[0]: best = (start, y)
            else: run = 0
    top, bottom = best
    mid = (top + bottom) // 2
    left = w // 2
    while left > 0 and isw(px[left - 1, mid]): left -= 1
    right = w // 2
    while right < w - 1 and isw(px[right + 1, mid]): right += 1
    return top, bottom, left, right


def emblem(im):
    """White emblem from a back: alpha = how white each pixel is compared with the back colour."""
    im = im.convert('RGBA'); w, h = im.size; px = im.load()
    bg = px[w // 2, int(h * .2)]; rim = px[int(w * .012), h // 2]
    box = (int(w * .1), int(h * .12), int(w * .9), int(h * .88))  # inside the white inset line
    sub = im.crop(box); sp = sub.load(); sw, sh = sub.size
    lo = min(bg[:3]); out = Image.new('RGBA', sub.size)
    op = out.load()
    for y in range(sh):
        for x in range(sw):
            p = sp[x, y]; a = max(0, min(255, int((min(p[:3]) - lo - 18) * 255 / max(1, 255 - lo - 40))))
            op[x, y] = (255, 255, 255, a)
    out = out.crop(out.getbbox())
    return out, '#%02x%02x%02x' % bg[:3], '#%02x%02x%02x' % rim[:3]


# Cards are shown at one standard shape (2:3). The trainer portraits are taller than that leaves
# room for, so a band at the bottom of the picture (just above its frame line) is removed.
TRIM = {'trainer-lead': (0.45, 0.637), 'trainer-support': (0.45, 0.637)}  # fractions of the trimmed height


def remove_band(im, a, b):
    h = im.size[1]; y0, y1 = round(h * a), round(h * b)
    out = Image.new('RGBA', (im.size[0], h - (y1 - y0)))
    out.paste(im.crop((0, 0, im.size[0], y0)), (0, 0)); out.paste(im.crop((0, y1, im.size[0], h)), (0, y0))
    return out


meta = {}
for f in sorted(os.listdir(SRC)):
    if not f.endswith('.png'): continue
    name = f[:-4]; im = Image.open(os.path.join(SRC, f))
    if name.startswith('back-'):
        im = clear_surround(im)
        em, bg, rim = emblem(im)
        em = em.resize((360, round(360 * em.size[1] / em.size[0])), Image.LANCZOS)
        em.save(os.path.join(OUT, name + '.webp'), quality=90)
        meta[name] = {'bg': bg, 'rim': rim, 'emblemAspect': round(em.size[0] / em.size[1], 3)}
    else:
        im = clear_surround(im)
        if name in TRIM: im = remove_band(im, *TRIM[name])
        im = im.resize((WIDTH, round(WIDTH * im.size[1] / im.size[0])), Image.LANCZOS)
        t, b, l, r = panel(im); w, h = im.size
        im.save(os.path.join(OUT, name + '.webp'), quality=84)
        meta[name] = {'w': w, 'h': h, 'top': round(t / h, 4), 'bottom': round(b / h, 4), 'left': round(l / w, 4), 'right': round(r / w, 4)}
    print(name, meta[name], os.path.getsize(os.path.join(OUT, name + '.webp')) // 1024, 'KB')

with open(os.path.join(ROOT, 'src/card-art.js'), 'w') as fh:
    fh.write('// Made by scripts/cards.py from art/source. Panel positions are fractions of the card image.\n')
    fh.write('export const CARD_ART = ' + json.dumps(meta, indent=1) + ';\n')
