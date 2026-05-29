#!/usr/bin/env python3
"""Split the generated dog multi-view sheet into Identity Graph zones."""

from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "assets/generated/duoduo-sheet/sheet-02.png"
OUT = ROOT / "assets/generated/duoduo-zones"

# VLM-observed panel boxes from the 1536x1024 generated sheet.
CROP_BOXES = {
    "full_front": (5, 5, 378, 405),
    "full_side": (385, 5, 785, 405),
    "full_back": (793, 5, 1102, 405),
    "half_body": (1110, 5, 1531, 405),
    "face_front": (5, 412, 531, 758),
    "face_left": (538, 412, 1014, 758),
    "face_right": (1021, 412, 1531, 758),
    "outfit": (5, 765, 531, 1018),
    "shoes": (538, 765, 1014, 1018),
    "bag": (1021, 765, 1531, 1018),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(SHEET)
    for zone, box in CROP_BOXES.items():
        target = OUT / f"{zone}.png"
        image.crop(box).save(target)
        print(f"{zone}: {target.relative_to(ROOT)} {box}")


if __name__ == "__main__":
    main()
