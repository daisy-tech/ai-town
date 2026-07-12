#!/usr/bin/env python3
"""Generate the warm, circular stone ground used by Wish Tree Plaza."""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw


SIZE = 576
CENTER = SIZE // 2
RADIUS = 270
OUTPUT = Path(__file__).resolve().parents[1] / "public/assets/pet-town/plaza/plaza-ground.png"


def inside_circle(x: int, y: int, inset: int = 0) -> bool:
    return (x - CENTER) ** 2 + (y - CENTER) ** 2 <= (RADIUS - inset) ** 2


def main() -> None:
    random.seed(20260712)
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.ellipse(
        (CENTER - RADIUS, CENTER - RADIUS, CENTER + RADIUS, CENTER + RADIUS),
        fill=(164, 155, 130, 255),
        outline=(104, 111, 81, 255),
        width=5,
    )

    # Irregular hand-laid pavers. Every other row is offset so the plaza does
    # not read as a spreadsheet grid.
    stone_width = 42
    stone_height = 29
    for row, y in enumerate(range(28, SIZE - 28, stone_height)):
        offset = -(stone_width // 2) if row % 2 else 0
        for x in range(24 + offset, SIZE - 24, stone_width):
            cx = x + stone_width // 2
            cy = y + stone_height // 2
            if not inside_circle(cx, cy, 9):
                continue
            jitter_x = random.randint(-2, 2)
            jitter_y = random.randint(-2, 2)
            shade = random.randint(-9, 9)
            fill = (176 + shade, 166 + shade, 140 + shade, 255)
            outline = (128, 124, 105, 255)
            draw.rounded_rectangle(
                (
                    x + 2 + jitter_x,
                    y + 2 + jitter_y,
                    x + stone_width - 3 + jitter_x,
                    y + stone_height - 3 + jitter_y,
                ),
                radius=6,
                fill=fill,
                outline=outline,
                width=2,
            )
            if random.random() < 0.22:
                draw.point((cx + jitter_x, cy + jitter_y), fill=(204, 190, 153, 255))

    # Soft moss and grass tufts break up the hard circular edge.
    for angle_step in range(0, 360, 5):
        angle = angle_step * 3.14159265 / 180
        distance = RADIUS - random.randint(0, 12)
        x = round(CENTER + distance * math.cos(angle))
        y = round(CENTER + distance * math.sin(angle))
        color = random.choice(((72, 112, 58, 255), (92, 132, 67, 255), (128, 153, 76, 255)))
        draw.line((x, y, x + random.randint(-5, 5), y - random.randint(4, 10)), fill=color, width=3)

    # A warmer gathering ring gives the tree and nearby characters a focal area.
    draw.ellipse((CENTER - 94, CENTER - 76, CENTER + 94, CENTER + 92), outline=(198, 180, 132, 180), width=5)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT)
    print(f"Generated {OUTPUT}")


if __name__ == "__main__":
    main()
