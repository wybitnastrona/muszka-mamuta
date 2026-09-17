#!/usr/bin/env python3
"""
Build KFD tub / powder textures from product photos.

The tub sits in front of a dark door, so flood-fill / corner-bg masks swallow
the room. GrabCut with a centre prior isolates the jar. Wrap is an authored
4×90° stitch (no flat unwrapped label). Scene millimetres stay fly-readable
in src/scene/scale.ts.

Usage (from repo root):
  .venv/bin/python scripts/textures/build_creatine.py
"""

from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.dirname(__file__))
from build_textures import (  # noqa: E402
    imread_rgb,
    make_tileable,
    median_color,
    normal_map,
    roughness_map,
    save,
)

PHOTOS = os.path.join(ROOT, "assets", "photos", "creatine")
OUT = os.path.join(ROOT, "public", "textures", "creatine")


def bgr(path: str) -> np.ndarray:
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    if im is None:
        raise FileNotFoundError(path)
    return im


def grab_subject(bgr_im: np.ndarray, rect: tuple[int, int, int, int], iters=5) -> np.ndarray:
    h, w = bgr_im.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr_im, mask, rect, bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    k = np.ones((7, 7), np.uint8)
    return cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k, iterations=2)


def largest_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    n, _labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        h, w = mask.shape
        return 0, 0, w, h
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, bw, bh, _ = stats[i]
    return int(x), int(y), int(x + bw), int(y + bh)


def side_crop(path: str) -> tuple[np.ndarray, dict]:
    im = bgr(path)
    h, w = im.shape[:2]
    rw, rh = int(w * 0.36), int(h * 0.62)
    rx, ry = w // 2 - rw // 2, int(h * 0.28)
    mask = grab_subject(im, (rx, ry, rw, rh), iters=5)
    x0, y0, x1, y1 = largest_bbox(mask)
    rgb = cv2.cvtColor(im[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    meta = {"bbox_px": {"w": x1 - x0, "h": y1 - y0}, "aspect_h_over_w": (y1 - y0) / max(1, x1 - x0)}
    return rgb, meta


def label_band(rgb: np.ndarray, lid_frac=0.18, base_frac=0.07, side_frac=0.16) -> np.ndarray:
    h, w = rgb.shape[:2]
    y0 = int(h * lid_frac)
    y1 = int(h * (1 - base_frac))
    x0 = int(w * side_frac)
    x1 = int(w * (1 - side_frac))
    if y1 - y0 < 24 or x1 - x0 < 24:
        return rgb
    return rgb[y0:y1, x0:x1]


def top_crop(path: str, frac=0.46) -> np.ndarray:
    im = bgr(path)
    h, w = im.shape[:2]
    s = int(min(w, h) * frac)
    rx, ry = w // 2 - s // 2, h // 2 - s // 2
    mask = grab_subject(im, (rx, ry, s, s), iters=4)
    x0, y0, x1, y1 = largest_bbox(mask)
    pad = 8
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w, x1 + pad), min(h, y1 + pad)
    return cv2.cvtColor(im[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)


def to_circle_rgba(rgb: np.ndarray, size=1024) -> np.ndarray:
    h, w = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    # Subject vs pale table: not near-white.
    mask = (gray < 210).astype(np.uint8) * 255
    k = np.ones((9, 9), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if cnts:
        (cx, cy), radius = cv2.minEnclosingCircle(max(cnts, key=cv2.contourArea))
    else:
        cx, cy, radius = w / 2, h / 2, min(w, h) * 0.48
    r = radius * 1.02
    x0 = int(max(0, cx - r))
    y0 = int(max(0, cy - r))
    x1 = int(min(w, cx + r))
    y1 = int(min(h, cy + r))
    crop = rgb[y0:y1, x0:x1]
    sq = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
    yy, xx = np.ogrid[:size, :size]
    circ = (xx - size / 2) ** 2 + (yy - size / 2) ** 2 <= (size * 0.495) ** 2
    rgba = np.zeros((size, size, 4), np.uint8)
    rgba[..., :3] = sq
    rgba[..., 3] = np.where(circ, 255, 0).astype(np.uint8)
    return rgba


def stitch_wrap(panels: list[np.ndarray], width=2048, height=512) -> np.ndarray:
    pw = width // len(panels)
    strips = [cv2.resize(p, (pw, height), interpolation=cv2.INTER_AREA) for p in panels]
    wrap = np.concatenate(strips, axis=1)
    blend = 20
    for i in range(1, len(strips)):
        x = i * pw
        left = wrap[:, x - blend:x].astype(np.float32)
        right = wrap[:, x:x + blend].astype(np.float32)
        t = np.linspace(0, 1, blend, dtype=np.float32)[None, :, None]
        wrap[:, x - blend:x] = (left * (1 - t) + right * t).astype(np.uint8)
    # u=0 seam
    a = wrap[:, :blend].astype(np.float32)
    b = wrap[:, -blend:].astype(np.float32)
    t = np.linspace(0, 1, blend, dtype=np.float32)[None, :, None]
    mix = (b * (1 - t) + a * t).astype(np.uint8)
    wrap[:, :blend] = mix
    wrap[:, -blend:] = mix
    return wrap


def powder_tile(path: str, size=1024) -> np.ndarray:
    rgb = imread_rgb(path)
    h, w = rgb.shape[:2]
    # Central mound, skip the grey paper field.
    side = int(min(h, w) * 0.42)
    y0, x0 = (h - side) // 2, (w - side) // 2
    square = rgb[y0:y0 + side, x0:x0 + side]
    lifted = np.clip(square.astype(np.float32) * 1.35, 0, 255).astype(np.uint8)
    return make_tileable(lifted, size)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    roles = {
        "front": "front.jpg",
        "back": "back.jpg",
        "left": "left.jpg",
        "right": "right.jpg",
        "lid_top": "lid_top.jpg",
        "well": "well.jpg",
        "lid_underside": "lid_underside.jpg",
        "bottom": "bottom.jpg",
        "logo": "logo.jpg",
        "powder_macro": "powder_macro.jpg",
    }
    paths = {k: os.path.join(PHOTOS, v) for k, v in roles.items()}
    for p in paths.values():
        if not os.path.isfile(p):
            raise SystemExit(f"missing {p}")

    measures: dict = {"note": "GrabCut bbox aspect includes the lid. Scene TUB_MM is authored fly-scale."}
    crops = {}
    for side in ("right", "back", "left", "front"):
        rgb, meta = side_crop(paths[side])
        crops[side] = rgb
        measures[side] = meta
        print(f"  {side} {meta['bbox_px']['w']}x{meta['bbox_px']['h']} aspect={meta['aspect_h_over_w']:.3f}")

    logo = imread_rgb(paths["logo"])
    lh, lw = logo.shape[:2]
    # Head-on label crop faces the kitchen camera (u=0.5 / −Z after the roll).
    front_band = logo[int(lh * 0.08):int(lh * 0.78), int(lw * 0.18):int(lw * 0.82)]
    # Three.js CylinderGeometry: u=0 is +Z (theta=0, x=sin, z=cos).
    # +theta walks +Z (back) → +X (right) → −Z (front, kitchen camera) → −X (left).
    wrap = stitch_wrap([
        label_band(crops["back"]),
        label_band(crops["right"]),
        front_band,
        label_band(crops["left"]),
    ])
    # Roll −1/8 turn so each 90° photo is centred on an axis (front at u=0.5 / −Z).
    wrap = np.roll(wrap, -wrap.shape[1] // 8, axis=1)
    wrap_path = os.path.join(OUT, "label_wrap.jpg")
    Image.fromarray(wrap).save(wrap_path, quality=88, optimize=True)
    print(f"  -> {wrap_path}  {wrap.shape[1]}x{wrap.shape[0]}")

    for key, fname in (
        ("lid_top", "lid_top.png"),
        ("lid_underside", "lid_underside.png"),
        ("well", "well.png"),
        ("bottom", "bottom.png"),
    ):
        arr = to_circle_rgba(top_crop(paths[key]), 1024)
        save(arr, os.path.join(OUT, fname))

    albedo = powder_tile(paths["powder_macro"])
    save(albedo, os.path.join(OUT, "creatine_crumb.png"))
    save(normal_map(albedo), os.path.join(OUT, "creatine_crumb_normal.png"))
    save(roughness_map(albedo), os.path.join(OUT, "creatine_crumb_rough.png"))
    rgb_med = median_color(albedo, crop=0.35)
    meta = {
        "label_wrap": "creatine/label_wrap.jpg",
        "lid_top": "creatine/lid_top.png",
        "lid_underside": "creatine/lid_underside.png",
        "well": "creatine/well.png",
        "bottom": "creatine/bottom.png",
        "creatine_crumb": "creatine/creatine_crumb.png",
        "creatine_crumb_normal": "creatine/creatine_crumb_normal.png",
        "creatine_crumb_rough": "creatine/creatine_crumb_rough.png",
        "creatine_median_rgb": rgb_med,
        "creatine_median_hex": "#%02x%02x%02x" % tuple(rgb_med),
    }
    with open(os.path.join(OUT, "textures.json"), "w") as f:
        json.dump(meta, f, indent=2)
    with open(os.path.join(PHOTOS, "measure.json"), "w") as f:
        json.dump(measures, f, indent=2)
    print("median", meta["creatine_median_hex"])


if __name__ == "__main__":
    main()
