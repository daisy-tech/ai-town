#!/usr/bin/env python3
"""Extract the approved wish-tree plaza concept into transparent game sprites."""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from statistics import median

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "public/assets/pet-town/plaza"
ARCHIVE_PATH = PROJECT_ROOT / "docs/ai-pet-town-wish-tree-plaza-tileset-concept.png"

# Crops are measured against the approved 1024x1024 concept board.
ASSETS = {
    "wish-tree.png": ((12, 292, 342, 690), (352, 416)),
    "notice-board.png": ((548, 548, 710, 790), (128, 128)),
    "small-stage.png": ((754, 548, 1014, 772), (160, 128)),
    "memory-leaf-rack.png": ((12, 790, 246, 1024), (160, 128)),
    "curved-bench.png": ((185, 680, 350, 782), (160, 64)),
    "plaza-lantern.png": ((236, 790, 330, 1024), (64, 96)),
}


def color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return math.sqrt(sum((left[channel] - right[channel]) ** 2 for channel in range(3)))


def remove_board_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    border_samples: list[tuple[int, int, int]] = []
    sample_depth = max(2, min(width, height) // 30)

    for x in range(width):
        for y in range(sample_depth):
            border_samples.append(rgba.getpixel((x, y))[:3])
            border_samples.append(rgba.getpixel((x, height - 1 - y))[:3])
    for y in range(height):
        for x in range(sample_depth):
            border_samples.append(rgba.getpixel((x, y))[:3])
            border_samples.append(rgba.getpixel((width - 1 - x, y))[:3])

    background = tuple(int(median(sample[channel] for sample in border_samples)) for channel in range(3))
    pixels = rgba.load()
    for x in range(width):
        for y in range(height):
            red, green, blue, _ = pixels[x, y]
            distance = color_distance((red, green, blue), background)
            if distance <= 24:
                alpha = 0
            elif distance >= 52:
                alpha = 255
            else:
                alpha = int((distance - 24) / 28 * 255)
            pixels[x, y] = (red, green, blue, alpha)
    return rgba


def trim_transparency(image: Image.Image, padding: int = 4) -> Image.Image:
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError("Asset crop became fully transparent")
    left, top, right, bottom = alpha_box
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


def connect_tree_parts(image: Image.Image, overlap: int = 22) -> Image.Image:
    """Join the separately drawn canopy and trunk into one continuous tree.

    On the concept board the canopy and trunk are separate elements with a
    transparent band between them; rendered as-is the tree looks cut in half.
    """
    alpha = image.getchannel("A")
    width, height = image.size
    data = list(alpha.getdata())
    row_counts = [sum(1 for x in range(width) if data[y * width + x] > 24) for y in range(height)]

    # Split the sprite into vertical content bands separated by transparent rows.
    bands: list[tuple[int, int]] = []
    start = None
    gap = 0
    for y, count in enumerate(row_counts):
        if count > 0:
            if start is None:
                start = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap > 4:
                bands.append((start, y - gap))
                start = None
                gap = 0
    if start is not None:
        bands.append((start, height - 1))
    if len(bands) < 2:
        return image

    # The first band is the canopy; the tallest remaining band is the trunk.
    # Anything else (stray specks on the concept board) is discarded.
    canopy_band = bands[0]
    trunk_band = max(bands[1:], key=lambda band: band[1] - band[0])
    canopy = trim_transparency(image.crop((0, canopy_band[0], width, canopy_band[1] + 1)), padding=0)
    trunk = trim_transparency(image.crop((0, trunk_band[0], width, trunk_band[1] + 1)), padding=0)

    composed_height = canopy.height + trunk.height - overlap
    composed_width = max(canopy.width, trunk.width)
    composed = Image.new("RGBA", (composed_width, composed_height), (0, 0, 0, 0))
    # Trunk first, canopy pasted over it so foliage hides the junction.
    composed.alpha_composite(trunk, ((composed_width - trunk.width) // 2, canopy.height - overlap))
    composed.alpha_composite(canopy, ((composed_width - canopy.width) // 2, 0))
    return composed


def contain_nearest(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_width, target_height = size
    scale = min(target_width / image.width, target_height / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.NEAREST,
    )
    output = Image.new("RGBA", size, (0, 0, 0, 0))
    output.alpha_composite(
        resized,
        ((target_width - resized.width) // 2, target_height - resized.height),
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Approved 1024x1024 plaza asset concept")
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    if source.size != (1024, 1024):
        raise ValueError(f"Expected a 1024x1024 source image, got {source.size}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source.save(ARCHIVE_PATH)

    for filename, (crop_box, target_size) in ASSETS.items():
        crop = source.crop(crop_box)
        transparent = remove_board_background(crop)
        if filename == "wish-tree.png":
            # The concept board places alternate trunk parts immediately to the
            # right of the main tree. Keep the full canopy, but mask those parts.
            pixels = transparent.load()
            for x in range(transparent.width):
                for y in range(transparent.height):
                    if (x > 250 and y > 205) or x > 326 or (x < 120 and y > 360):
                        red, green, blue, _ = pixels[x, y]
                        pixels[x, y] = (red, green, blue, 0)
        if filename == "notice-board.png":
            pixels = transparent.load()
            for x in range(transparent.width):
                for y in range(transparent.height):
                    if x > 120 and y > 170:
                        red, green, blue, _ = pixels[x, y]
                        pixels[x, y] = (red, green, blue, 0)
        trimmed = trim_transparency(transparent)
        if filename == "wish-tree.png":
            trimmed = connect_tree_parts(trimmed)
        output = contain_nearest(trimmed, target_size)
        output.save(OUTPUT_DIR / filename)
        print(f"Generated {filename}: {output.size[0]}x{output.size[1]}")


if __name__ == "__main__":
    main()
