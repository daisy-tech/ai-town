#!/usr/bin/env python3
"""Generate the deterministic tileset used by the AI-PetTown graybox map."""

from pathlib import Path
from PIL import Image, ImageDraw


TILE_SIZE = 32
TILESET_COLUMNS = 8
TILESET_ROWS = 3


def tile_origin(index: int) -> tuple[int, int]:
    return (index % TILESET_COLUMNS * TILE_SIZE, index // TILESET_COLUMNS * TILE_SIZE)


def draw_tile(
    image: Image.Image,
    index: int,
    base: tuple[int, int, int, int],
    accent: tuple[int, int, int, int],
    pattern: str,
) -> None:
    x, y = tile_origin(index)
    draw = ImageDraw.Draw(image)
    draw.rectangle((x, y, x + TILE_SIZE - 1, y + TILE_SIZE - 1), fill=base)

    if pattern == "speckles":
        for px, py in ((4, 7), (18, 4), (27, 12), (11, 23), (25, 27), (5, 29)):
            draw.rectangle((x + px, y + py, x + px + 1, y + py + 1), fill=accent)
        for px, py in ((8, 12), (21, 18), (14, 29)):
            draw.line((x + px, y + py, x + px + 2, y + py - 2), fill=(131, 170, 99, 255))
    elif pattern == "path":
        for box in ((3, 5, 5, 7), (22, 3, 25, 5), (11, 19, 14, 21), (27, 26, 29, 28)):
            draw.ellipse((x + box[0], y + box[1], x + box[2], y + box[3]), fill=accent)
        draw.line((x + 2, y + 13, x + 7, y + 12), fill=accent, width=1)
        draw.line((x + 18, y + 29, x + 23, y + 28), fill=accent, width=1)
    elif pattern == "planks":
        for py in (8, 16, 24):
            draw.line((x, y + py, x + TILE_SIZE - 1, y + py), fill=accent, width=1)
        for px in (7, 22):
            draw.line((x + px, y, x + px, y + TILE_SIZE - 1), fill=accent, width=1)
    elif pattern == "grid":
        for offset in (0, 16):
            draw.line((x + offset, y, x + offset, y + TILE_SIZE - 1), fill=accent, width=1)
            draw.line((x, y + offset, x + TILE_SIZE - 1, y + offset), fill=accent, width=1)
    elif pattern == "waves":
        for py in (7, 16, 25):
            draw.arc((x + 2, y + py - 3, x + 17, y + py + 3), 0, 180, fill=accent, width=2)
            draw.arc((x + 16, y + py - 3, x + 31, y + py + 3), 0, 180, fill=accent, width=2)
    elif pattern == "stones":
        for box in ((2, 3, 14, 14), (17, 1, 30, 12), (6, 17, 20, 29), (22, 16, 31, 28)):
            bx1, by1, bx2, by2 = box
            draw.rounded_rectangle((x + bx1, y + by1, x + bx2, y + by2), radius=3, outline=accent)
    elif pattern == "tree":
        draw.rectangle((x + 13, y + 17, x + 19, y + 31), fill=accent)
        draw.ellipse((x + 3, y + 1, x + 28, y + 24), fill=base, outline=accent, width=2)
        draw.ellipse((x + 8, y + 4, x + 22, y + 17), fill=accent)
    elif pattern == "wall":
        draw.rectangle((x, y, x + TILE_SIZE - 1, y + TILE_SIZE - 1), outline=accent, width=3)
        draw.line((x + 2, y + 16, x + 29, y + 16), fill=accent, width=2)
    elif pattern == "fence":
        draw.rectangle((x + 3, y + 6, x + 7, y + 31), fill=accent)
        draw.rectangle((x + 25, y + 6, x + 29, y + 31), fill=accent)
        draw.rectangle((x, y + 12, x + 31, y + 16), fill=accent)
    elif pattern == "furniture":
        draw.rounded_rectangle((x + 3, y + 8, x + 28, y + 27), radius=3, fill=accent)
        draw.rectangle((x + 7, y + 3, x + 24, y + 10), fill=base)
    elif pattern == "rocks":
        draw.ellipse((x + 2, y + 11, x + 16, y + 28), fill=accent)
        draw.ellipse((x + 13, y + 4, x + 29, y + 27), fill=base, outline=accent, width=2)


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "public/assets/pet-town-graybox.png"
    image = Image.new(
        "RGBA",
        (TILESET_COLUMNS * TILE_SIZE, TILESET_ROWS * TILE_SIZE),
        (0, 0, 0, 0),
    )

    tiles = [
        ((116, 157, 88, 255), (85, 126, 67, 255), "speckles"),    # 0 grass
        ((202, 174, 119, 255), (164, 132, 84, 255), "path"),       # 1 dirt path
        ((173, 125, 79, 255), (137, 92, 56, 255), "planks"),      # 2 home/shop floor
        ((190, 161, 112, 255), (151, 121, 78, 255), "grid"),      # 3 school/library floor
        ((126, 169, 100, 255), (83, 137, 77, 255), "grid"),       # 4 garden/field
        ((75, 148, 183, 255), (143, 202, 218, 255), "waves"),     # 5 water
        ((151, 107, 66, 255), (105, 72, 47, 255), "planks"),      # 6 bridge
        ((171, 161, 137, 255), (126, 121, 105, 255), "stones"),   # 7 plaza
        ((67, 112, 64, 255), (46, 79, 43, 255), "tree"),          # 8 trees
        ((149, 100, 70, 255), (94, 61, 45, 255), "wall"),         # 9 home wall
        ((168, 124, 82, 255), (91, 73, 57, 255), "wall"),         # 10 school wall
        ((117, 135, 114, 255), (66, 79, 68, 255), "wall"),        # 11 library wall
        ((174, 117, 95, 255), (104, 69, 59, 255), "wall"),        # 12 shop wall
        ((126, 91, 56, 255), (86, 57, 34, 255), "fence"),         # 13 fence
        ((137, 96, 63, 255), (91, 60, 39, 255), "furniture"),     # 14 furniture
        ((113, 123, 126, 255), (76, 87, 91, 255), "rocks"),       # 15 rocks
    ]

    for index, (base, accent, pattern) in enumerate(tiles):
        draw_tile(image, index, base, accent, pattern)

    # Tile 16 intentionally stays transparent. It participates in pathfinding
    # collision without leaking graybox furniture blocks into the rendered map.
    image.save(output)
    print(f"Generated {output}")


if __name__ == "__main__":
    main()
