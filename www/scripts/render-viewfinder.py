# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "pillow", "imageio-ffmpeg"]
# ///
"""Renders what the judges' demo phone shows: a hand-held phone's view of a gallery wall hung with the sample paintings.

    uv run www/scripts/render-viewfinder.py [--preview 3.2,12,...]

Reads `media/paintings/` and writes `media/phone/`, which the demo server copies into the app's Documents:
`viewfinder.mp4`, its segment list `viewfinder.json`, a thumbnail per painting in `thumbs/`, and a still per painting
in `photos/`. The app reads these names (`shared/capture/judges-demo.ts`). `--preview` writes only the frames at the
given times, to `.context/viewfinder-preview/`.

The video opens with an idle loop, standing back from the wall, then has one walk per painting: the phone swings in,
walks up and settles long enough for the app's steadiness window. Frames are 3:4 portrait like the phone camera's
stills, so the app's cover-fitted preview shows the middle of each one the way it shows a camera frame.
"""

import argparse
import json
import math
from dataclasses import dataclass
from multiprocessing import Pool
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "media"
PHONE = MEDIA / "phone"
WIDTH, HEIGHT, FPS = 1080, 1440, 30
# Portrait iPhone main camera: 53° across the short side.
FOCAL = (WIDTH / 2) / math.tan(math.radians(53.1 / 2))
# The app's preview cover-fits the frame on a 1206 x 2622 screen, showing this share of the frame's width.
VISIBLE_WIDTH = (1206 / 2622) / (WIDTH / HEIGHT)
CEILING = 4.2
EYE = 1.47
WALL_PPM = 200
FLOOR_PPM = 150
LABEL_PPM = 2400
EXPOSURE_S = 1 / 60
SEED = 7


@dataclass(frozen=True)
class Work:
    file: str
    artist: str
    title: str
    date: str
    width: float  # metres, painting only; huge works are hung smaller so every shot stays at arm's length
    frame: str


WORKS = [
    Work("mona-lisa-leonardo.jpg", "Leonardo da Vinci", "Mona Lisa", "c. 1503–19", 0.53, "gilt"),
    Work("roses-van-gogh.jpg", "Vincent van Gogh", "Roses", "1890", 0.74, "wood"),
    Work("girl-with-a-pearl-earring-vermeer.jpg", "Johannes Vermeer", "Girl with a Pearl Earring", "c. 1665", 0.40, "dark"),
    Work("a-sunday-on-la-grande-jatte-seurat.jpg", "Georges Seurat", "A Sunday on La Grande Jatte — 1884", "1884–86", 1.55, "white"),
    Work("self-portrait-with-a-straw-hat-van-gogh.jpg", "Vincent van Gogh", "Self-Portrait with a Straw Hat", "1887", 0.33, "gold"),
    Work("the-death-of-socrates-david.jpg", "Jacques-Louis David", "The Death of Socrates", "1787", 1.45, "gilt"),
    Work("the-bedroom-van-gogh.jpg", "Vincent van Gogh", "The Bedroom", "1889", 0.92, "wood"),
    Work("wheat-field-with-cypresses-van-gogh.jpg", "Vincent van Gogh", "Wheat Field with Cypresses", "1889", 0.93, "gold"),
]
# Where the phone stands for each painting, as a share of its distance: off to the side and a little high or low.
STANCES = [(-0.10, 0.02), (0.14, -0.04), (0.04, 0.03), (-0.16, -0.02), (0.08, 0.04), (-0.06, -0.03), (0.12, 0.01), (-0.09, 0.03)]
GAP = 1.15
LABEL_SIZE = (0.11, 0.075)


def to_linear(srgb: np.ndarray) -> np.ndarray:
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb(linear: np.ndarray) -> np.ndarray:
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


def smootherstep(u):
    u = np.clip(u, 0, 1)
    return u * u * u * (u * (u * 6 - 15) + 10)


def font(size: int, bold=False, italic=False):
    names = {
        (False, False): "/System/Library/Fonts/Supplemental/Georgia.ttf",
        (True, False): "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
        (False, True): "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
    }
    try:
        return ImageFont.truetype(names[(bold, italic)], size)
    except OSError:
        return ImageFont.load_default(size)


GOLD = np.array([0.42, 0.27, 0.085], np.float32)


def moulding(style: str, s: np.ndarray, along: np.ndarray, grain: np.ndarray) -> np.ndarray:
    """Linear colour across a moulding: `s` runs from the outer edge (0) to the sight edge (1), `along` follows it."""
    def bands(points, values):
        return np.interp(s, points, values).astype(np.float32)[..., None]

    if style == "gilt":
        relief = bands([0, 0.06, 0.1, 0.4, 0.44, 0.47, 0.52, 0.56, 0.8, 0.83, 0.88, 0.94, 1], [0.45, 0.6, 1.0, 0.95, 1.2, 1.65, 0.6, 1.0, 1.05, 0.5, 1.35, 1.1, 0.45])
        carving = np.where((s > 0.12) & (s < 0.38), np.sin(2 * np.pi * along / 0.32) * np.sin(np.pi * (s - 0.12) / 0.26), 0)
        relief = relief * (1 + 0.28 * carving[..., None])
        color = GOLD * relief
    elif style == "gold":
        relief = bands([0, 0.08, 0.3, 0.6, 0.78, 0.82, 0.9, 1], [0.55, 0.95, 1.25, 1.0, 0.95, 0.55, 1.3, 0.5])
        color = GOLD * relief
    else:
        paint = {"dark": [0.022, 0.018, 0.015], "wood": [0.085, 0.047, 0.024], "white": [0.72, 0.70, 0.65]}[style]
        relief = bands([0, 0.08, 0.35, 0.7, 0.84, 1], [0.6, 1.0, 1.3, 1.0, 0.9, 0.6])
        color = np.array(paint, np.float32) * relief
        if style != "white":
            lip = (s > 0.84) & (s < 0.95)
            color[lip] = GOLD * np.interp(s[lip], [0.84, 0.89, 0.95], [0.7, 1.35, 0.6])[..., None]
    # Gilding and lacquer catch the light along their crests.
    sheen = np.clip(relief - 1.15, 0, None) * np.array([0.55, 0.5, 0.35], np.float32)
    return (color + sheen) * (1 + 0.06 * grain)[..., None]


def framed_texture(work: Work, rng: np.random.Generator):
    """The painting in its moulding as linear RGBA, with its physical size and pixels per metre."""
    painting = to_linear(np.asarray(Image.open(MEDIA / "paintings" / work.file).convert("RGB"), dtype=np.float32) / 255)
    ppm = painting.shape[1] / work.width
    height = work.width * painting.shape[0] / painting.shape[1]
    border = {"white": 0.055, "gold": 0.06}.get(work.frame, min(max(0.085 * max(work.width, height), 0.055), 0.12))
    b = round(border * ppm)
    h, w = painting.shape[0] + 2 * b, painting.shape[1] + 2 * b
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    # Distance into the moulding from each side; the nearest side owns the pixel, which mitres the corners.
    sides = np.stack([ys, w - 1 - xs, h - 1 - ys, xs])
    side = sides.argmin(0)
    s = sides.min(0) / b
    horizontal = (side == 0) | (side == 2)
    along = np.where(horizontal, xs, ys) / b
    # Wood grain and gilding wear run along each member.
    noise = rng.normal(0, 1, (h, w)).astype(np.float32)
    streaks = np.where(horizontal, cv2.GaussianBlur(noise, (0, 0), sigmaX=b / 4, sigmaY=1), cv2.GaussianBlur(noise, (0, 0), sigmaX=1, sigmaY=b / 4))
    streaks /= streaks.std() + 1e-6
    # Light falls from above: the top member faces it, the bottom one is in shade.
    facing = np.choose(side, [1.15, 0.9, 0.62, 0.95]).astype(np.float32)
    rgb = moulding(work.frame, s, along, streaks) * facing[..., None]
    rgb[b:-b, b:-b] = painting
    # The sight edge shades the top of the canvas.
    shade = 1 - 0.4 * np.exp(-np.arange(painting.shape[0]) / (0.01 * ppm))
    rgb[b:-b, b:-b] *= shade[:, None, None]
    texture = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], -1).astype(np.float32)
    texture = np.pad(texture, ((2, 2), (2, 2), (0, 0)))
    return texture, ppm, work.width + 2 * border, height + 2 * border


def label_texture(work: Work):
    w, h = round(LABEL_SIZE[0] * LABEL_PPM), round(LABEL_SIZE[1] * LABEL_PPM)
    card = Image.new("RGB", (w, h), (238, 236, 230))
    draw = ImageDraw.Draw(card)
    pad = round(0.008 * LABEL_PPM)
    draw.text((pad, pad), work.artist, font=font(round(h * 0.13), bold=True), fill=(40, 38, 36))
    title_font = font(round(h * 0.12), italic=True)
    words, lines = work.title.split(), [""]
    for word in words:
        candidate = f"{lines[-1]} {word}".strip()
        if draw.textlength(candidate, font=title_font) > w - 2 * pad:
            lines.append(word)
        else:
            lines[-1] = candidate
    y = pad + round(h * 0.2)
    for line in lines:
        draw.text((pad, y), line, font=title_font, fill=(55, 52, 50))
        y += round(h * 0.15)
    draw.text((pad, y + round(h * 0.03)), f"{work.date}\nOil on canvas", font=font(round(h * 0.1)), fill=(90, 88, 84))
    rgb = to_linear(np.asarray(card, dtype=np.float32) / 255)
    texture = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], -1)
    return np.pad(texture, ((2, 2), (2, 2), (0, 0))), LABEL_PPM


def blur_across_lap(image: np.ndarray, sigma_x: float, sigma_y: float | None = None) -> np.ndarray:
    """Gaussian blur that wraps around the wall's horizontal seam, so the lap repeats without an edge."""
    pad = int(3 * max(sigma_x, sigma_y or sigma_x)) + 1
    padded = np.pad(image, ((0, 0), (pad, pad)), mode="wrap")
    return cv2.GaussianBlur(padded, (0, 0), sigmaX=sigma_x, sigmaY=sigma_y or sigma_x)[:, pad:-pad]


def mipmaps(texture: np.ndarray, levels=5):
    chain = [texture]
    for _ in range(levels):
        if min(chain[-1].shape[:2]) < 16:
            break
        chain.append(cv2.pyrDown(chain[-1]))
    return chain


@dataclass
class Element:
    x0: float
    x1: float
    y0: float
    y1: float
    chain: list
    ppm: float


class Gallery:
    def __init__(self):
        rng = np.random.default_rng(SEED)
        self.elements: list[Element] = []
        self.anchors = []
        x = GAP / 2
        for index, work in enumerate(WORKS):
            texture, ppm, fw, fh = framed_texture(work, rng)
            center_y = 1.55 if fh < 1.2 else 1.62
            x0, y0 = x, center_y - fh / 2
            self.elements.append(Element(x0, x0 + fw, y0, y0 + fh, mipmaps(texture), ppm))
            label, label_ppm = label_texture(work)
            lx = x0 + fw + 0.22
            self.elements.append(Element(lx, lx + LABEL_SIZE[0], 1.22, 1.22 + LABEL_SIZE[1], mipmaps(label), label_ppm))
            # Far enough back that the framed painting fills most of the visible preview, as someone scanning would hold it.
            distance = max(fw / (0.88 * VISIBLE_WIDTH * WIDTH / FOCAL), fh / (0.6 * HEIGHT / FOCAL))
            side, lift = STANCES[index]
            self.anchors.append((x0 + fw / 2, center_y, distance, side, lift))
            x = lx + LABEL_SIZE[0] + GAP
        self.lap = x
        self.wall, self.light = self.wall_textures(rng)
        self.floor = self.floor_texture(rng)

    def light_at(self, xs, ys):
        """Track spots wash each painting in a warm pool that fades towards the floor and the ceiling."""
        light = 0.3 + 0.05 * ys / CEILING
        for element in self.elements[::2]:
            cx, cy = (element.x0 + element.x1) / 2, (element.y0 + element.y1) / 2 + 0.08
            sx, sy = 0.5 * (element.x1 - element.x0) + 0.35, 0.5 * (element.y1 - element.y0) + 0.42
            for shift in (-self.lap, 0, self.lap):
                r2 = ((xs - cx - shift) / sx) ** 2 + ((ys - cy) / sy) ** 2
                light = light + 1.05 * np.exp(-0.5 * r2**1.35) + 0.22 * np.exp(-0.5 * r2 / 4)
        return light * (0.7 + 0.3 * smootherstep(ys / 1.0))

    def wall_textures(self, rng):
        w, h = round(self.lap * WALL_PPM), round(CEILING * WALL_PPM)
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        wx, wy = xs / WALL_PPM, CEILING - ys / WALL_PPM
        light = self.light_at(wx, wy).astype(np.float32)
        paint = to_linear(np.array([0.95, 0.935, 0.9], np.float32))
        mottle = blur_across_lap(rng.normal(0, 1, (h, w)).astype(np.float32), 25)
        albedo = paint[None, None, :] * (1 + 0.025 * mottle / (mottle.std() + 1e-6))[..., None]
        skirting = wy < 0.11
        albedo[skirting] = to_linear(np.array([0.83, 0.82, 0.8], np.float32))
        albedo[(wy >= 0.11) & (wy < 0.115)] *= 0.75
        occlusion = np.ones((h, w), np.float32)
        occlusion *= 1 - 0.35 * np.exp(-wy / 0.05) - 0.25 * np.exp(-(CEILING - wy) / 0.12)
        shadow = np.zeros((h, w), np.float32)
        for element in self.elements:
            x0, x1 = round(element.x0 * WALL_PPM), round(element.x1 * WALL_PPM)
            top, bottom = round((CEILING - element.y1 + 0.03) * WALL_PPM), round((CEILING - element.y0 + 0.03) * WALL_PPM)
            shadow[top:bottom, x0 + 2 : x1 + 2] = 1
        shadow = blur_across_lap(shadow, 0.022 * WALL_PPM)
        rgb = albedo * (light * occlusion * (1 - 0.6 * shadow))[..., None]
        return rgb.astype(np.float32), light

    def floor_texture(self, rng):
        depth = 9.0
        w, h = round(self.lap * FLOOR_PPM), round(depth * FLOOR_PPM)
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        plank = (ys / (0.14 * FLOOR_PPM)).astype(int)
        offsets = rng.uniform(0, self.lap, 200)
        tint = rng.uniform(0.85, 1.12, 200).astype(np.float32)
        along = (xs / FLOOR_PPM + offsets[plank % 200]) % self.lap
        board_len = 1.6
        joint = (along % board_len) < 0.004
        streak = blur_across_lap(rng.normal(0, 1, (h, w)).astype(np.float32), 40, 1.2)
        wood = to_linear(np.array([0.62, 0.47, 0.33], np.float32))
        shade = tint[plank % 200] * (1 + 0.08 * streak / (streak.std() + 1e-6))
        shade[(ys % (0.14 * FLOOR_PPM)) < 1] *= 0.6
        shade[joint] *= 0.6
        z = ys / FLOOR_PPM
        light = 0.22 + 0.25 * np.exp(-z / 1.4)
        return (wood[None, None, :] * (shade * light)[..., None]).astype(np.float32)

    # Camera path -----------------------------------------------------------------------------------------------

    def anchor_pose(self, index: int):
        x, y, distance, side, lift = self.anchors[index]
        position = np.array([x + side * distance, EYE + (y - 1.55) * 0.6 + lift * distance, -distance])
        target = np.array([x, y, 0.0])
        return position, target


def periodic_noise(t, period, rng_seed, bands):
    rng = np.random.default_rng(rng_seed)
    total = 0.0
    for low, high, amplitude, count in bands:
        for _ in range(count):
            cycles = max(1, round(rng.uniform(low, high) * period))
            total += amplitude / math.sqrt(count) * math.sin(2 * math.pi * cycles * t / period + rng.uniform(0, 2 * math.pi))
    return total


IDLE_S = 8.0
WALK_S = 7.0
SWING_S = 1.2
SWING_DEG = 14
APPROACH_S = 2.6
# Slow hand sway only: a phone's stabilized preview shows no tremor.
STEADY = [(0.2, 1.1, 1.0, 4)]


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    painting: int | None  # None for the idle loop


class Timeline:
    """The video's segments: an idle loop standing back from the wall, then one walk up to each painting."""

    def __init__(self, gallery: Gallery):
        self.gallery = gallery
        walks = [Segment(IDLE_S + i * WALK_S, IDLE_S + (i + 1) * WALK_S, i) for i in range(len(WORKS))]
        self.segments = [Segment(0.0, IDLE_S, None), *walks]
        self.duration = walks[-1].end

    def segment_at(self, t: float) -> Segment:
        return next(segment for segment in reversed(self.segments) if t >= segment.start)

    def pose(self, segment: Segment, local: float):
        length = segment.end - segment.start
        if segment.painting is None:
            return self.idle_pose(local % length)
        return self.walk_pose(segment.painting, min(local, length - 1e-3))

    def idle_pose(self, local: float):
        # Periodic over the loop, so it repeats without a seam.
        def n(seed, bands):
            return periodic_noise(local, IDLE_S, seed, bands)

        sway = [(0.12, 0.5, 1.0, 3)]
        # Far enough back that Girl with a Pearl Earring and La Grande Jatte both show on the phone's screen.
        elements = self.gallery.elements
        x = (elements[4].x0 + elements[6].x1) / 2
        position = np.array([x + 0.02 * n(4, sway), EYE - 0.08 + 0.01 * n(5, STEADY), -6.6])
        target = np.array([x, 1.35, 0.0])
        yaw = math.radians(0.5 * n(1, sway))
        pitch = math.radians(0.35 * n(2, sway))
        roll = math.radians(0.8 + 0.5 * n(3, sway))
        return position, target, yaw, pitch, roll

    def walk_pose(self, index: int, local: float):
        def n(seed, bands):
            return periodic_noise(local, WALK_S, seed + 20 * index, bands)

        anchor, target = self.gallery.anchor_pose(index)
        distance = self.gallery.anchors[index][2]
        start = anchor + np.array([-0.45 * distance, -0.05, -0.55 * distance])
        u = min(local / APPROACH_S, 1)
        position = start + (anchor - start) * smootherstep(u)
        # Steps rock the phone in proportion to walking speed, so the walk eases in and out of the sway.
        walking = 16 * u * u * (1 - u) ** 2
        # The phone swings in from the left, then the walk settles it on the painting.
        swing = -math.radians(SWING_DEG) * (1 - smootherstep(local / SWING_S))
        yaw = swing + math.radians(0.2 * n(1, STEADY) + 0.4 * walking * n(11, [(0.6, 1.4, 1.0, 2)]))
        pitch = math.radians(0.16 * n(2, STEADY) + 0.2 * walking * n(12, [(1.6, 2.2, 1.0, 1)]))
        roll = math.radians(0.9 + 0.3 * n(3, [(0.1, 0.6, 1.0, 3)]) + 0.4 * walking * n(13, [(0.8, 1.2, 1.0, 1)]))
        bob = 0.004 * walking * n(14, [(1.7, 2.1, 1.0, 1)])
        position = position + np.array([0.003 * n(4, STEADY), 0.003 * n(5, STEADY) + bob, 0.004 * n(6, STEADY)])
        return position, target, yaw, pitch, roll


def basis(position, target, yaw, pitch, roll):
    forward = target - position
    forward /= np.linalg.norm(forward)
    right = np.cross([0.0, 1.0, 0.0], forward)
    right /= np.linalg.norm(right)
    up = np.cross(forward, right)
    def rotate(v, axis, angle):
        return v * math.cos(angle) + np.cross(axis, v) * math.sin(angle) + axis * np.dot(axis, v) * (1 - math.cos(angle))
    forward, right = rotate(forward, up, yaw), rotate(right, up, yaw)
    forward, up = rotate(forward, right, pitch), rotate(up, right, pitch)
    right, up = rotate(right, forward, roll), rotate(up, forward, roll)
    return forward, right, up


def sample(chain, ppm, u_m, v_m, screen_ppm):
    level = int(np.clip(math.floor(math.log2(max(ppm / max(screen_ppm, 1e-3), 1)) + 0.25), 0, len(chain) - 1))
    texture = chain[level]
    scale = ppm / (2**level)
    return cv2.remap(texture, (u_m * scale + 2 / 2**level).astype(np.float32), (v_m * scale + 2 / 2**level).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def render(gallery: Gallery, pose, width: int, height: int) -> np.ndarray:
    position, target, yaw, pitch, roll = pose
    forward, right, up = basis(position, target, yaw, pitch, roll)
    focal = FOCAL * width / WIDTH
    py, px = np.mgrid[0:height, 0:width].astype(np.float32)
    a, b = (px + 0.5 - width / 2) / focal, -(py + 0.5 - height / 2) / focal
    dx = forward[0] + right[0] * a + up[0] * b
    dy = forward[1] + right[1] * a + up[1] * b
    dz = forward[2] + right[2] * a + up[2] * b
    with np.errstate(divide="ignore", invalid="ignore"):
        t_wall = np.where(dz > 1e-6, -position[2] / dz, np.inf)
        t_floor = np.where(dy < -1e-6, -position[1] / dy, np.inf)
        t_ceiling = np.where(dy > 1e-6, (CEILING - position[1]) / dy, np.inf)
    hit = np.argmin(np.stack([t_wall, t_floor, t_ceiling]), 0)
    out = np.zeros((height, width, 3), np.float32)

    wall = hit == 0
    with np.errstate(invalid="ignore", over="ignore"):
        wx = position[0] + t_wall * dx
        wy = position[1] + t_wall * dy
        fx = position[0] + t_floor * dx
        fz = -(position[2] + t_floor * dz)
    lap = gallery.lap
    wxm = np.mod(np.where(wall, wx, 0), lap).astype(np.float32)
    wym = np.where(wall, wy, 0).astype(np.float32)
    wall_rgb = cv2.remap(gallery.wall, wxm * WALL_PPM, (CEILING - wym) * WALL_PPM, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    out[wall] = wall_rgb[wall]
    light = cv2.remap(gallery.light, wxm * WALL_PPM, (CEILING - wym) * WALL_PPM, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    for element in gallery.elements:
        inside = wall & (wxm > element.x0 - 0.01) & (wxm < element.x1 + 0.01) & (wym > element.y0 - 0.01) & (wym < element.y1 + 0.01)
        if not inside.any():
            continue
        rows, cols = np.where(inside.any(1))[0], np.where(inside.any(0))[0]
        r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
        region = (slice(r0, r1), slice(c0, c1))
        depth = float(np.median(t_wall[region][inside[region]]))
        texel = sample(element.chain, element.ppm, wxm[region] - element.x0, element.y1 - wym[region], focal / depth)
        alpha = texel[..., 3:4] * inside[region][..., None]
        lit = texel[..., :3] * (0.25 + 0.9 * light[region][..., None])
        out[region] = out[region] * (1 - alpha) + lit * alpha

    floor = hit == 1
    fx = np.mod(np.where(floor, fx, 0), lap)
    floor_rgb = cv2.remap(gallery.floor, fx.astype(np.float32) * FLOOR_PPM, np.where(floor, fz, 0).astype(np.float32) * FLOOR_PPM, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    out[floor] = floor_rgb[floor]
    ceiling = hit == 2
    out[ceiling] = to_linear(np.array([0.55, 0.55, 0.54], np.float32))
    return out


def develop(linear: np.ndarray, rng: np.random.Generator | None) -> np.ndarray:
    """Phone camera look: vignette, soft highlight roll-off, a little lens softness and sensor noise."""
    height, width = linear.shape[:2]
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    r2 = ((xs - width / 2) / (width / 2)) ** 2 * 0.5 + ((ys - height / 2) / (height / 2)) ** 2 * 0.5
    # Warm gallery lighting that the camera's white balance only partly corrects.
    x = linear * (1 - 0.12 * r2)[..., None] * np.array([1.0, 0.95, 0.86], np.float32)
    x = x * (1 + x / 2.2**2) / (1 + x)
    x = cv2.GaussianBlur(x, (0, 0), 0.55)
    srgb = to_srgb(x)
    if rng is not None:
        srgb = srgb + rng.normal(0, 0.006, (height, width, 1)) + rng.normal(0, 0.002, (height, width, 3))
    return (np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8)


def screen_motion(start_pose, end_pose) -> float:
    """Largest pixel distance a wall point travels on screen during the exposure."""
    points = []
    for pose in (start_pose, end_pose):
        position, target, yaw, pitch, roll = pose
        forward, right, up = basis(position, target, yaw, pitch, roll)
        points.append((position, forward, right, up))
    (p0, f0, r0, u0), (p1, f1, r1, u1) = points
    worst = 0.0
    for a, b in ((0, 0), (-0.4, -0.5), (0.4, 0.5), (-0.4, 0.5), (0.4, -0.5)):
        ray = f0 + r0 * a * WIDTH / FOCAL + u0 * b * HEIGHT / FOCAL
        if ray[2] <= 0:
            continue
        hit = p0 + ray * (-p0[2] / ray[2])
        rel = hit - p1
        z = rel @ f1
        sx, sy = FOCAL * (rel @ r1) / z, FOCAL * (rel @ u1) / z
        worst = max(worst, math.hypot(sx - a * WIDTH, sy - b * HEIGHT))
    return worst


GALLERY: Gallery | None = None
TIMELINE: Timeline | None = None


def init():
    global GALLERY, TIMELINE
    GALLERY = Gallery()
    TIMELINE = Timeline(GALLERY)


def frame(index: int) -> bytes:
    t = index / FPS
    segment = TIMELINE.segment_at(t)
    local = t - segment.start
    # Motion blur stays inside the frame's segment: segments meet at a cut.
    def at(offset: float):
        return TIMELINE.pose(segment, local + offset)

    motion = screen_motion(at(0), at(EXPOSURE_S))
    samples = int(np.clip(math.ceil(motion / 2.5), 1, 14))
    scale = 2 if samples > 3 else 1
    accum = np.zeros((HEIGHT // scale, WIDTH // scale, 3), np.float32)
    for k in range(samples):
        accum += render(GALLERY, at(EXPOSURE_S * (k + 0.5) / samples), WIDTH // scale, HEIGHT // scale)
    accum /= samples
    if scale > 1:
        accum = cv2.resize(accum, (WIDTH, HEIGHT), interpolation=cv2.INTER_LINEAR)
    return develop(accum, np.random.default_rng(index)).tobytes()


def still(segment: Segment, local: float, scale: float) -> Image.Image:
    width, height = round(WIDTH * scale), round(HEIGHT * scale)
    linear = render(GALLERY, TIMELINE.pose(segment, local), width, height)
    return Image.fromarray(develop(linear, np.random.default_rng(round(segment.start * 1000 + local))))


def thumbnail(work: Work, size=192) -> Image.Image:
    image = Image.open(MEDIA / "paintings" / work.file).convert("RGB")
    side = min(image.size)
    left, top = (image.width - side) // 2, (image.height - side) // 2
    return image.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--preview", help="comma-separated times to render as PNGs instead of the video")
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()
    init()
    if args.preview:
        out = ROOT.parent / ".context" / "viewfinder-preview"
        out.mkdir(parents=True, exist_ok=True)
        for when in args.preview.split(","):
            index = round(float(when) * FPS)
            Image.frombytes("RGB", (WIDTH, HEIGHT), frame(index)).save(out / f"t{float(when):06.2f}.png")
        print(f"wrote previews to {out}")
        return
    for folder in ("thumbs", "photos"):
        (PHONE / folder).mkdir(parents=True, exist_ok=True)
    count = round(TIMELINE.duration * FPS)
    writer = imageio_ffmpeg.write_frames(
        str(PHONE / "viewfinder.mp4"),
        (WIDTH, HEIGHT),
        fps=FPS,
        codec="libx264",
        quality=None,
        pix_fmt_out="yuv420p",
        macro_block_size=8,
        # A keyframe every second, so every segment start seeks exactly and cheaply.
        output_params=["-crf", "24", "-preset", "slow", "-g", str(FPS), "-movflags", "+faststart", "-an"],
    )
    writer.send(None)
    with Pool(args.workers, initializer=init) as pool:
        for done, data in enumerate(pool.imap(frame, range(count), chunksize=4)):
            writer.send(data)
            if done % 90 == 0:
                print(f"frame {done}/{count}", flush=True)
    writer.close()
    idle, *walks = TIMELINE.segments
    paintings = []
    for work, walk in zip(WORKS, walks):
        thumbnail(work).save(PHONE / "thumbs" / work.file, quality=90)
        # Late in the walk, where the phone has settled on the painting.
        still(walk, 5.0, 1.6).save(PHONE / "photos" / work.file, quality=90)
        paintings.append({
            "title": work.title,
            "artist": work.artist,
            "thumbnail": f"thumbs/{work.file}",
            "walk": {"start": walk.start, "end": walk.end},
        })
    manifest = {"idle": {"start": idle.start, "end": idle.end}, "paintings": paintings}
    (PHONE / "viewfinder.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {count} frames and {len(WORKS)} paintings to {PHONE}")


if __name__ == "__main__":
    main()
