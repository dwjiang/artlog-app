from PIL import Image, ImageStat


def letterbox(img: Image.Image, size: int) -> Image.Image:
    """Square `size`×`size` canvas: bilinear resize so the long side equals `size`, centered,
    padded with the resized image's per-channel mean color. The phone's Swift implementation
    must match this exactly."""
    rgb = img.convert("RGB")
    width, height = rgb.size
    scale = size / max(width, height)
    resized = rgb.resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.BILINEAR,
    )
    # Half-up rounding so Swift's `.rounded()` on positive means gives the same pad color.
    mean = tuple(int(channel + 0.5) for channel in ImageStat.Stat(resized).mean)
    canvas = Image.new("RGB", (size, size), mean)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas
