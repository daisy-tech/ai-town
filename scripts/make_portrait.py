"""Process an AI-generated character portrait for in-game use.

Chroma-keys the green background to transparency, crops to the subject,
pads to a square (anchored to the top so the head stays fully visible),
and resizes to 256x256.

Usage: python3 make_portrait.py input.png output.png
"""
import sys
from PIL import Image


def main():
    src_path, out_path = sys.argv[1:3]
    src = Image.open(src_path).convert('RGBA')
    px = src.load()
    w, h = src.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if g > 100 and g > r * 1.6 and g > b * 1.6:
                px[x, y] = (0, 0, 0, 0)

    crop = src.crop(src.getbbox())
    side = max(crop.width, crop.height)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(crop, ((side - crop.width) // 2, 0), crop)
    out = sq.resize((256, 256), Image.LANCZOS)
    out.save(out_path)
    print(f'Wrote {out_path} {out.size}')


if __name__ == '__main__':
    main()
