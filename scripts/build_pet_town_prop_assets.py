#!/usr/bin/env python3
"""Cut the three approved 4x4 prop boards into transparent game sprites."""

from __future__ import annotations

import argparse
import math
from collections import deque
from pathlib import Path
from statistics import median

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "public/assets/pet-town/props"
DOCS_DIR = PROJECT_ROOT / "docs"

GRID = 4

# Cell name layout per board, row-major.
BOARDS: dict[str, list[str]] = {
    "home-school": [
        "bed-red", "bed-blue", "sofa", "flower-table",
        "dining-table", "home-shelf", "floor-lamp", "rug",
        "school-desk", "chalkboard", "teacher-desk", "craft-table",
        "slide", "swing", "sandbox", "potted-plant",
    ],
    "nature": [
        "apple-tree", "apple-tree-ladder", "bush", "flower-bush",
        "flowerbed-tulip", "flowerbed-mixed", "plot-cabbage", "plot-carrot",
        "picnic-table", "fence-segment", "scarecrow", "wheelbarrow",
        "rocks", "boulder", "stump", "wildflowers",
    ],
    "library-shop": [
        "bookshelf-a", "bookshelf-b", "reading-table", "armchair",
        "easel", "piano", "drawing-board", "pottery-table",
        "shop-counter", "shop-shelf", "post-box", "bus-stop",
        "dock", "bench", "street-lamp", "crates",
    ],
}


def color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return math.sqrt(sum((left[i] - right[i]) ** 2 for i in range(3)))


def cut_cell(cell: Image.Image) -> Image.Image | None:
    """Remove the board background via border flood fill, keep the main prop."""
    rgba = cell.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()

    border: list[tuple[int, int, int]] = []
    for x in range(width):
        border.append(pixels[x, 0][:3])
        border.append(pixels[x, height - 1][:3])
    for y in range(height):
        border.append(pixels[0, y][:3])
        border.append(pixels[width - 1, y][:3])
    background = tuple(int(median(sample[i] for sample in border)) for i in range(3))

    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index]:
            return
        if color_distance(pixels[x, y][:3], background) > 26:
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
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    # Keep only the largest opaque component (drops stray specks).
    alpha = rgba.getchannel("A")
    data = list(alpha.getdata())
    seen = bytearray(width * height)
    largest: list[int] = []
    for start in range(width * height):
        if seen[start] or data[start] <= 24:
            continue
        component = []
        stack = [start]
        seen[start] = 1
        while stack:
            index = stack.pop()
            component.append(index)
            cx, cy = index % width, index // width
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < width and 0 <= ny < height:
                        neighbor = ny * width + nx
                        if not seen[neighbor] and data[neighbor] > 24:
                            seen[neighbor] = 1
                            stack.append(neighbor)
        if len(component) > len(largest):
            largest = component
    keep = set(largest)
    for index in range(width * height):
        if index not in keep and data[index] > 0:
            x, y = index % width, index // width
            r, g, b, _ = pixels[x, y]
            pixels[x, y] = (r, g, b, 0)

    bounds = rgba.getchannel("A").getbbox()
    if bounds is None:
        return None
    left, top, right, bottom = bounds
    pad = 3
    return rgba.crop(
        (max(0, left - pad), max(0, top - pad), min(width, right + pad), min(height, bottom + pad))
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs=3, type=Path, help="home-school, nature, library-shop boards")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for board_name, source_path in zip(BOARDS, args.sources):
        board = Image.open(source_path).convert("RGBA")
        board.save(DOCS_DIR / f"ai-pet-town-props-{board_name}.png")
        cell_w = board.width // GRID
        cell_h = board.height // GRID
        names = BOARDS[board_name]
        for index, name in enumerate(names):
            col, row = index % GRID, index // GRID
            cell = board.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))
            sprite = cut_cell(cell)
            if sprite is None:
                print(f"WARNING: {board_name}/{name} came out empty")
                continue
            sprite.save(OUTPUT_DIR / f"{name}.png")
            print(f"{name}: {sprite.size[0]}x{sprite.size[1]}")


if __name__ == "__main__":
    main()
