"""Seeded camera nuisances, applied before the shared letterbox preprocessing."""

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps


def augment(image: Image.Image, *, seed: int) -> dict[str, Image.Image]:
    rng = np.random.default_rng(seed)
    rgb = image.convert("RGB")
    width, height = rgb.size
    crop_width = max(2, round(width * rng.uniform(0.7, 1)))
    crop_height = max(2, round(height * rng.uniform(0.7, 1)))
    left = int(rng.integers(0, max(1, width - crop_width + 1)))
    top = int(rng.integers(0, max(1, height - crop_height + 1)))
    crop = np.asarray(rgb.crop((left, top, left + crop_width, top + crop_height)))
    corners = np.float32([[0, 0], [crop_width, 0], [crop_width, crop_height], [0, crop_height]])
    points = np.column_stack((corners - [crop_width / 2, crop_height / 2], np.zeros(4)))
    pitch, yaw = np.deg2rad(rng.uniform(-15, 15, 2))
    rx = np.array(
        [[1, 0, 0], [0, np.cos(pitch), -np.sin(pitch)], [0, np.sin(pitch), np.cos(pitch)]]
    )
    ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
    rotated = points @ (ry @ rx).T
    focal = 2 * max(crop_width, crop_height)
    projected = rotated[:, :2] * focal / (focal + rotated[:, 2:])
    projected += [crop_width / 2, crop_height / 2]
    transform = cv2.getPerspectiveTransform(corners, projected.astype(np.float32))
    warped = cv2.warpPerspective(
        crop, transform, (crop_width, crop_height), borderMode=cv2.BORDER_REPLICATE
    )

    mask = Image.new("L", rgb.size)
    cx, cy = rng.uniform(0.2, 0.8, 2) * [width, height]
    ex, ey = rng.uniform(0.12, 0.4, 2) * [width, height]
    ImageDraw.Draw(mask).ellipse((cx - ex, cy - ey, cx + ex, cy + ey), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(min(width, height) * 0.06))
    alpha = np.asarray(mask, dtype=np.float32)[..., None] / 255 * rng.uniform(0.3, 0.6)
    pixels = np.asarray(rgb, dtype=np.float32)
    glare = pixels * (1 - alpha) + 255 * alpha
    dark = (pixels / 255) ** rng.uniform(1.6, 2.2) * 255
    dark += rng.normal(0, 3, dark.shape)
    border = int(rng.integers(10, 26))
    color = (int(rng.integers(65, 120)), 48, 27) if rng.random() < 0.5 else (15, 15, 15)
    frame = ImageOps.expand(rgb, border=border, fill=color).filter(
        ImageFilter.GaussianBlur(rng.uniform(0.3, 0.8))
    )
    return {
        "perspective": Image.fromarray(warped),
        "glare": Image.fromarray(np.clip(glare, 0, 255).astype(np.uint8)),
        "low-light": Image.fromarray(np.clip(dark, 0, 255).astype(np.uint8)),
        "frame": frame,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Save 20 augmentation previews for visual review")
    parser.add_argument("image", type=Path)
    parser.add_argument("--out", type=Path, default=Path("out/augment-samples"))
    parser.add_argument("--seed", type=int, default=20260911)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with Image.open(args.image) as image:
        for offset in range(5):
            for name, variant in augment(image, seed=args.seed + offset).items():
                variant.save(args.out / f"{offset}-{name}.jpg")


if __name__ == "__main__":
    main()
