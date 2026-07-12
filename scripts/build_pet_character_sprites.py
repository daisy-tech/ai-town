#!/usr/bin/env python3
"""Build 48px walking sheets and portraits from the approved pet turnaround board."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "public/assets/sprites/pets"
ARCHIVE_PATH = PROJECT_ROOT / "docs/ai-pet-town-character-turnarounds.png"

CELL = 48
SHEET_COLUMNS = 3
SHEET_ROWS = 4
DEFAULT_PETS = ("mochi", "nana", "bobo", "coco", "mimi")

# Generated source rows are front, right-facing, left-facing and back.
DIRECTION_SOURCE_ROWS = (0, 2, 1, 3)  # output: down, left, right, up


def remove_checkerboard(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def looks_like_background(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        # The generated checkerboard is flattened RGB rather than transparency.
        # A generous flood-fill threshold removes its anti-aliased variations,
        # while the dark character outlines protect enclosed white fur.
        return max(red, green, blue) - min(red, green, blue) <= 30 and min(red, green, blue) >= 195

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or not looks_like_background(x, y):
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)
    return rgba


def find_bands(sums: list[int], threshold: int, min_gap: int) -> list[tuple[int, int]]:
    """Locate contiguous content bands in an alpha projection histogram."""
    bands: list[tuple[int, int]] = []
    start = None
    gap = 0
    for index, value in enumerate(sums):
        if value > threshold:
            if start is None:
                start = index
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                bands.append((start, index - gap))
                start = None
                gap = 0
    if start is not None:
        bands.append((start, len(sums) - 1))
    return bands


def detect_grid(
    transparent: Image.Image, expected_columns: int
) -> tuple[list[tuple[int, int]], list[list[tuple[int, int]]]]:
    """Detect the character columns and, per column, the 4 pose rows.

    The generated board never aligns exactly to a fixed 205x256 grid, so fixed
    crops truncated poses that straddled a boundary. Projecting the alpha
    channel finds where each character actually is.
    """
    alpha = transparent.getchannel("A")
    width, height = alpha.size
    data = list(alpha.getdata())

    col_sums = [0] * width
    for y in range(height):
        base = y * width
        for x in range(width):
            if data[base + x] > 24:
                col_sums[x] += 1
    col_bands = find_bands(col_sums, threshold=2, min_gap=8)
    if len(col_bands) != expected_columns:
        raise ValueError(f"Expected {expected_columns} character columns, found {col_bands}")

    row_bands_per_col: list[list[tuple[int, int]]] = []
    for start, end in col_bands:
        per_row = [0] * height
        for y in range(height):
            base = y * width
            for x in range(start, end + 1):
                if data[base + x] > 24:
                    per_row[y] += 1
        bands = find_bands(per_row, threshold=2, min_gap=6)
        if len(bands) != 4:
            raise ValueError(f"Expected 4 pose rows in column {start}-{end}, found {bands}")
        row_bands_per_col.append(bands)
    return col_bands, row_bands_per_col


def trim(image: Image.Image, padding: int = 3) -> Image.Image:
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("No character pixels found in source cell")
    left, top, right, bottom = bounds
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


def keep_largest_component(image: Image.Image) -> Image.Image:
    """Discard checkerboard residue and detached source-board decorations."""
    rgba = image.copy()
    width, height = rgba.size
    alpha = rgba.getchannel("A")
    visited: set[tuple[int, int]] = set()
    largest: set[tuple[int, int]] = set()

    for start_y in range(height):
        for start_x in range(width):
            start = (start_x, start_y)
            if start in visited or alpha.getpixel(start) <= 24:
                continue
            component: set[tuple[int, int]] = set()
            queue = deque([start])
            visited.add(start)
            while queue:
                x, y = queue.popleft()
                component.add((x, y))
                for dx, dy in (
                    (-1, -1),
                    (0, -1),
                    (1, -1),
                    (-1, 0),
                    (1, 0),
                    (-1, 1),
                    (0, 1),
                    (1, 1),
                ):
                    nx, ny = x + dx, y + dy
                    neighbor = (nx, ny)
                    if (
                        0 <= nx < width
                        and 0 <= ny < height
                        and neighbor not in visited
                        and alpha.getpixel(neighbor) > 24
                    ):
                        visited.add(neighbor)
                        queue.append(neighbor)
            if len(component) > len(largest):
                largest = component

    pixels = rgba.load()
    for y in range(height):
        for x in range(width):
            if (x, y) not in largest:
                red, green, blue, _ = pixels[x, y]
                pixels[x, y] = (red, green, blue, 0)
    return rgba


def fit_character(image: Image.Image) -> Image.Image:
    max_width = 42
    max_height = 46
    scale = min(max_width / image.width, max_height / image.height)
    return image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )


def place_frame(sheet: Image.Image, character: Image.Image, column: int, row: int) -> None:
    horizontal_steps = (-1, 0, 1)
    x = column * CELL + (CELL - character.width) // 2 + horizontal_steps[column]
    y = row * CELL + CELL - character.height - (1 if column == 1 else 0)
    sheet.alpha_composite(character, (x, y))


def create_portrait(front: Image.Image) -> Image.Image:
    # Use the head and upper torso so expressions remain readable in the panel.
    head = front.crop((0, 0, front.width, max(1, round(front.height * 0.64))))
    head = trim(head, padding=2)
    scale = min(224 / head.width, 224 / head.height)
    resized = head.resize(
        (max(1, round(head.width * scale)), max(1, round(head.height * scale))),
        Image.Resampling.LANCZOS,
    )
    portrait = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    portrait.alpha_composite(resized, ((256 - resized.width) // 2, 256 - resized.height - 12))
    return portrait


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Approved turnaround board")
    parser.add_argument(
        "--pets",
        default=",".join(DEFAULT_PETS),
        help="Comma-separated output names, one per character column in the board",
    )
    args = parser.parse_args()
    pets = tuple(name for name in args.pets.split(",") if name)

    source = Image.open(args.source)
    transparent = remove_checkerboard(source)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if pets == DEFAULT_PETS:
        source.save(ARCHIVE_PATH)

    col_bands, row_bands_per_col = detect_grid(transparent, len(pets))

    for pet_index, pet_name in enumerate(pets):
        raw_directions: list[Image.Image] = []
        directions: list[Image.Image] = []
        x1, x2 = col_bands[pet_index]
        row_bands = row_bands_per_col[pet_index]
        for source_row in DIRECTION_SOURCE_ROWS:
            y1, y2 = row_bands[source_row]
            crop = transparent.crop((max(0, x1 - 4), max(0, y1 - 4), x2 + 5, y2 + 5))
            raw = trim(keep_largest_component(crop))
            raw_directions.append(raw)
            directions.append(fit_character(raw))

        sheet = Image.new(
            "RGBA",
            (SHEET_COLUMNS * CELL, SHEET_ROWS * CELL),
            (0, 0, 0, 0),
        )
        for row, character in enumerate(directions):
            for column in range(SHEET_COLUMNS):
                place_frame(sheet, character, column, row)

        sheet.save(OUTPUT_DIR / f"{pet_name}.png")
        create_portrait(raw_directions[0]).save(OUTPUT_DIR / f"{pet_name}-portrait.png")
        print(f"Generated {pet_name}: {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
