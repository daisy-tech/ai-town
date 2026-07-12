#!/usr/bin/env python3
"""Render the full pet town map (tiles + static sprites) to a PNG for review."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC = PROJECT_ROOT / "public"
DUMP = Path("/tmp/pet-town-map-dump.json")
OUTPUT = Path("/tmp/pet-town-full-preview.png")


def main() -> None:
    data = json.loads(DUMP.read_text())
    tiledim = data["tiledim"]
    width, height = data["width"], data["height"]

    tileset = Image.open(PUBLIC / data["tilesetpath"].replace("/ai-town/", "")).convert("RGBA")
    columns = tileset.width // tiledim

    def tile_image(index: int) -> Image.Image:
        col, row = index % columns, index // columns
        return tileset.crop((col * tiledim, row * tiledim, (col + 1) * tiledim, (row + 1) * tiledim))

    canvas = Image.new("RGBA", (width * tiledim, height * tiledim), (0, 0, 0, 255))
    for layer in data["bgtiles"]:
        for x in range(width):
            for y in range(height):
                index = layer[x][y]
                if index >= 0:
                    canvas.alpha_composite(tile_image(index), (x * tiledim, y * tiledim))
    for layer in data["objmap"]:
        for x in range(width):
            for y in range(height):
                index = layer[x][y]
                if index >= 0:
                    canvas.alpha_composite(tile_image(index), (x * tiledim, y * tiledim))

    # Below-character sprites first, then depth-sorted ones in sortY order.
    sprites = data["staticsprites"]
    flat = [s for s in sprites if "sortY" not in s]
    sorted_sprites = sorted((s for s in sprites if "sortY" in s), key=lambda s: s["sortY"])
    for sprite in flat + sorted_sprites:
        image = Image.open(PUBLIC / sprite["url"].replace("/ai-town/", "")).convert("RGBA")
        image = image.resize((round(sprite["w"]), round(sprite["h"])), Image.Resampling.LANCZOS)
        canvas.alpha_composite(image, (round(sprite["x"]), round(sprite["y"])))

    canvas.save(OUTPUT)
    print(f"Saved {OUTPUT} ({canvas.width}x{canvas.height})")


if __name__ == "__main__":
    main()
