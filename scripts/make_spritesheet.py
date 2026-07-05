#!/usr/bin/env python3
"""Convert an AI-generated 3x4 walking sheet into a game-ready 96x128 spritesheet.

Input: image with 12 poses on a solid green background, arranged in 3 columns
(animation frames) x 4 rows (down / left / right / up).
Output: 96x128 PNG, 32x32 cells, same row order as data/spritesheets/f*.ts.

Usage: python3 make_spritesheet.py input.png output.png [--cell 48] [--preview preview.png]
"""
import sys
from PIL import Image

CELL = 32
COLS, ROWS = 3, 4


def chroma_key(img: Image.Image) -> Image.Image:
    """Make green background pixels transparent."""
    img = img.convert('RGBA')
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # Bright/medium green with green channel dominating.
            if g > 100 and g > r * 1.6 and g > b * 1.6:
                px[x, y] = (0, 0, 0, 0)
    return img


def bands(mask, min_gap=4, expected=None):
    """Find contiguous True ranges, merging ranges separated by tiny gaps."""
    ranges = []
    start = None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            ranges.append([start, i])
            start = None
    if start is not None:
        ranges.append([start, len(mask)])
    # Merge ranges separated by less than min_gap empty pixels.
    merged = []
    for r in ranges:
        if merged and r[0] - merged[-1][1] < min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    if expected is not None and len(merged) > expected:
        # Keep the largest `expected` bands (drops stray specks).
        merged.sort(key=lambda r: r[1] - r[0], reverse=True)
        merged = sorted(merged[:expected])
    return merged


def segment_sprites(img: Image.Image):
    """Split the sheet into ROWS x COLS sprites by projecting the alpha
    channel: content bands separated by fully transparent gaps."""
    alpha = img.getchannel('A')
    w, h = img.size
    data = alpha.load()
    row_mask = [any(data[x, y] > 0 for x in range(w)) for y in range(h)]
    row_bands = bands(row_mask, expected=ROWS)
    if len(row_bands) != ROWS:
        raise SystemExit(f'Expected {ROWS} sprite rows, found {len(row_bands)}')
    sprites = []
    for y0, y1 in row_bands:
        col_mask = [any(data[x, y] > 0 for y in range(y0, y1)) for x in range(w)]
        col_bands = bands(col_mask, expected=COLS)
        if len(col_bands) != COLS:
            raise SystemExit(f'Expected {COLS} sprites in row, found {len(col_bands)}')
        row_sprites = []
        for x0, x1 in col_bands:
            cell = img.crop((x0, y0, x1, y1))
            bbox = cell.getbbox()
            row_sprites.append(cell.crop(bbox))
        sprites.append(row_sprites)
    return sprites


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview_path = None
    if '--preview' in sys.argv:
        preview_path = sys.argv[sys.argv.index('--preview') + 1]
        args = [a for a in args if a != preview_path]
    cell = CELL
    if '--cell' in sys.argv:
        cell = int(sys.argv[sys.argv.index('--cell') + 1])
        args = [a for a in args if a != str(cell)]
    src_path, out_path = args
    # Character height inside the cell and baseline (feet) position.
    target_h = cell - 2
    baseline = cell - 1

    img = chroma_key(Image.open(src_path))

    sheet = Image.new('RGBA', (cell * COLS, cell * ROWS), (0, 0, 0, 0))
    # Use one uniform scale for all frames so the character doesn't "breathe"
    # between animation frames. Scale from the tallest sprite.
    sprites = segment_sprites(img)
    max_h = max(s.height for row in sprites for s in row)
    scale = target_h / max_h

    for cy in range(ROWS):
        for cx in range(COLS):
            s = sprites[cy][cx]
            nw = max(1, round(s.width * scale))
            nh = max(1, round(s.height * scale))
            small = s.resize((nw, nh), Image.LANCZOS)
            # Crisp pixel-art look: keep hard alpha edges.
            alpha = small.getchannel('A').point(lambda v: 255 if v >= 128 else 0)
            small.putalpha(alpha)
            ox = cx * cell + (cell - nw) // 2
            oy = cy * cell + (baseline - nh)
            sheet.paste(small, (ox, oy), small)

    sheet.save(out_path)
    print(f'Wrote {out_path} ({sheet.size[0]}x{sheet.size[1]})')

    if preview_path:
        big = sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST)
        big.save(preview_path)
        print(f'Wrote {preview_path}')


if __name__ == '__main__':
    main()
