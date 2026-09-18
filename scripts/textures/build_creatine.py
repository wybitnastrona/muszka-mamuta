#!/usr/bin/env python3
"""
Build KFD tub / powder textures from product photos.

The wrap is a black-plastic cylinder (4096×1024) with only the printed label
band from the photos — not a photogrammetry of the jar, door, or desk.
Brown wood and pale table pixels are replaced with #151515. Photos already
show upright glyphs; do not rot90. CylinderGeometry u=0 is +Z, u=0.5 is −Z
(front). Panels are rolled so KFD sits on the camera face.

Scene millimetres stay fly-readable in src/scene/scale.ts.

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
    exposure_lift,
    imread_rgb,
    make_tileable,
    median_color,
    normal_map,
    roughness_map,
    save,
)

# IMG_8525 / powder_macro is a dark frame; this gain is authored so the
# crumb luminance can still drive a normal map after the albedo map is dropped.
POWDER_EXPOSURE_GAIN = 2.85

PHOTOS = os.path.join(ROOT, "assets", "photos", "creatine")
OUT = os.path.join(ROOT, "public", "textures", "creatine")
PLASTIC = (0x15, 0x15, 0x15)


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


def pale_studio_mask(rgb: np.ndarray) -> np.ndarray:
    """Large / border-touching pale regions (desk, backdrop) — not white print."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    s, v = hsv[:, :, 1], hsv[:, :, 2]
    pale = (v >= 165) & (s <= 50)
    h, w = pale.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(pale.astype(np.uint8) * 255, 8)
    min_area = h * w * 0.035
    border_min = h * w * 0.008
    out = np.zeros(pale.shape, dtype=bool)
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        touches = x == 0 or y == 0 or x + bw >= w or y + bh >= h
        if area >= min_area or (touches and area >= border_min):
            out |= labels == i
    return out


def room_mask(rgb: np.ndarray) -> np.ndarray:
    """Desk, door and ceiling — not the matte black label or its print."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    desk = pale_studio_mask(rgb)
    brown = (h >= 4) & (h <= 30) & (s >= 28) & (v >= 40) & (v <= 205)
    wood = (h >= 8) & (h <= 25) & (s >= 18) & (v >= 70) & (v <= 210)
    ceiling = (v >= 130) & (s <= 30) & (h >= 85)
    return desk | brown | wood | ceiling


def on_plastic(rgb: np.ndarray) -> np.ndarray:
    out = rgb.copy()
    out[room_mask(rgb)] = PLASTIC
    return out


def label_keep_mask(rgb: np.ndarray) -> np.ndarray:
    """Keep the black label band (low sat, low-mid V) plus light print on it."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    black_matte = (v <= 70) & (s <= 70)
    print_ink = (v >= 140) & (s <= 55)
    lime = (h >= 32) & (h <= 95) & (s >= 40) & (v >= 70)
    keep = black_matte | print_ink | lime
    keep &= ~room_mask(rgb)
    k = np.ones((9, 9), np.uint8)
    mask = keep.astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=1)
    return mask


def crop_label_band(rgb: np.ndarray) -> np.ndarray:
    """Bbox of the printed band only; room pixels become #151515."""
    painted = on_plastic(rgb)
    mask = label_keep_mask(painted)
    if int(mask.sum()) < 255 * 64:
        return strip_lid_rows(painted)
    x0, y0, x1, y1 = largest_bbox(mask)
    pad_x = max(4, (x1 - x0) // 40)
    pad_y = max(4, (y1 - y0) // 30)
    h, w = painted.shape[:2]
    x0, y0 = max(0, x0 - pad_x), max(0, y0 - pad_y)
    x1, y1 = min(w, x1 + pad_x), min(h, y1 + pad_y)
    band = painted[y0:y1, x0:x1]
    m = mask[y0:y1, x0:x1]
    canvas = np.full_like(band, PLASTIC)
    canvas[m > 0] = band[m > 0]
    return strip_lid_rows(canvas)


def strip_lid_rows(rgb: np.ndarray) -> np.ndarray:
    """Drop leftover lid / table rows that have no print."""
    if rgb.shape[0] < 24:
        return rgb
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    print_ink = (v >= 150) & (s <= 60)
    lime = (h >= 32) & (h <= 95) & (s >= 40) & (v >= 70)
    useful = (print_ink | lime).mean(axis=1)
    hits = np.where(useful > 0.012)[0]
    if hits.size < 8:
        return rgb
    y0 = max(0, int(hits[0]) - 6)
    y1 = min(rgb.shape[0], int(hits[-1]) + 10)
    return rgb[y0:y1]


def jar_label_face(
    rgb: np.ndarray,
    lid_frac: float = 0.34,
    base_frac: float = 0.12,
    side_frac: float = 0.26,
) -> np.ndarray:
    """Skip lid, base and silhouette; keep the matte printed wrap."""
    painted = on_plastic(rgb)
    h, w = painted.shape[:2]
    y0 = int(h * lid_frac)
    y1 = max(y0 + 16, int(h * (1 - base_frac)))
    x0 = int(w * side_frac)
    x1 = max(x0 + 16, int(w * (1 - side_frac)))
    face = painted[y0:y1, x0:x1]
    return crop_label_band(face)


def side_crop(path: str) -> tuple[np.ndarray, dict]:
    im = bgr(path)
    h, w = im.shape[:2]
    rw, rh = int(w * 0.36), int(h * 0.62)
    rx, ry = w // 2 - rw // 2, int(h * 0.28)
    mask = grab_subject(im, (rx, ry, rw, rh), iters=5)
    x0, y0, x1, y1 = largest_bbox(mask)
    rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
    band = jar_label_face(rgb[y0:y1, x0:x1])
    meta = {
        "bbox_px": {"w": band.shape[1], "h": band.shape[0]},
        "aspect_h_over_w": band.shape[0] / max(1, band.shape[1]),
    }
    return band, meta


def panel_on_black(rgb: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    """Fill cylinder height; pillarbox on #151515 so KFD is not cover-cropped off."""
    canvas = np.full((out_h, out_w, 3), PLASTIC, np.uint8)
    h, w = rgb.shape[:2]
    if h < 8 or w < 8:
        return canvas
    scale = out_h / h
    nw = max(1, int(round(w * scale)))
    fitted = cv2.resize(rgb, (nw, out_h), interpolation=cv2.INTER_AREA)
    if nw >= out_w:
        x0 = (nw - out_w) // 2
        canvas[:] = fitted[:, x0:x0 + out_w]
    else:
        x0 = (out_w - nw) // 2
        canvas[:, x0:x0 + nw] = fitted
    return canvas


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


def stitch_wrap(panels: list[np.ndarray], width=4096, height=1024) -> np.ndarray:
    pw = width // len(panels)
    strips = [panel_on_black(p, pw, height) for p in panels]
    wrap = np.concatenate(strips, axis=1)
    blend = 20
    for i in range(1, len(strips)):
        x = i * pw
        left = wrap[:, x - blend:x].astype(np.float32)
        right = wrap[:, x:x + blend].astype(np.float32)
        t = np.linspace(0, 1, blend, dtype=np.float32)[None, :, None]
        wrap[:, x - blend:x] = (left * (1 - t) + right * t).astype(np.uint8)
    a = wrap[:, :blend].astype(np.float32)
    b = wrap[:, -blend:].astype(np.float32)
    t = np.linspace(0, 1, blend, dtype=np.float32)[None, :, None]
    mix = (b * (1 - t) + a * t).astype(np.uint8)
    wrap[:, :blend] = mix
    wrap[:, -blend:] = mix
    return wrap


def powder_tile(path: str, size=1024) -> tuple[np.ndarray, np.ndarray]:
    """Return (detail_tile, lifted_albedo). Normals come from the unclipped crop."""
    rgb = imread_rgb(path)
    h, w = rgb.shape[:2]
    side = int(min(h, w) * 0.42)
    y0, x0 = (h - side) // 2, (w - side) // 2
    square = rgb[y0:y0 + side, x0:x0 + side]
    detail = make_tileable(square, size)
    lifted = make_tileable(exposure_lift(square, POWDER_EXPOSURE_GAIN), size)
    return detail, lifted


def crop_packshot_label(path: str) -> np.ndarray:
    """Tight crop of the printed band from a studio packshot (no lid, no studio)."""
    rgb = cv2.cvtColor(bgr(path), cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    v = hsv[:, :, 2]
    s = hsv[:, :, 1]
    ink = ~((v >= 245) & (s <= 18))
    ys, xs = np.where(ink)
    if xs.size < 64:
        return jar_label_face(rgb, lid_frac=0.22, base_frac=0.04, side_frac=0.16)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    jar_h = max(1, y1 - y0)
    jar_w = max(1, x1 - x0)
    # Keep the facing label; a 10% inset ate KFD on the packshot.
    y0b = y0 + int(jar_h * 0.18)
    y1b = y1 - int(jar_h * 0.02)
    x0b = x0 + int(jar_w * 0.02)
    x1b = x1 - int(jar_w * 0.20)
    band = rgb[y0b:y1b, x0b:x1b]
    # Studio packshot already has white print on black; do not paint glyphs as desk.
    return strip_lid_rows(band)


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
        "pack_front": "pack_front.png",
    }
    paths = {k: os.path.join(PHOTOS, v) for k, v in roles.items()}
    for key, p in paths.items():
        if key == "pack_front":
            continue
        if not os.path.isfile(p):
            raise SystemExit(f"missing {p}")

    measures: dict = {
        "note": "Label-band crop on #151515. Tub H=142 mm measured; Ø from packshot aspect.",
    }
    crops = {}
    for side in ("right", "back", "left", "front"):
        rgb, meta = side_crop(paths[side])
        crops[side] = rgb
        measures[side] = meta
        print(f"  {side} {meta['bbox_px']['w']}x{meta['bbox_px']['h']} aspect={meta['aspect_h_over_w']:.3f}")

    pack = paths["pack_front"]
    if os.path.isfile(pack):
        front_band = crop_packshot_label(pack)
        measures["pack_front"] = {
            "bbox_px": {"w": int(front_band.shape[1]), "h": int(front_band.shape[0])},
            "aspect_h_over_w": front_band.shape[0] / max(1, front_band.shape[1]),
        }
        print(f"  pack_front {front_band.shape[1]}x{front_band.shape[0]}")
    else:
        logo_rgb = cv2.cvtColor(bgr(paths["logo"]), cv2.COLOR_BGR2RGB)
        front_band = jar_label_face(logo_rgb, lid_frac=0.38, base_frac=0.06, side_frac=0.18)
    # Three.js CylinderGeometry: u=0 is +Z. +theta: +Z (back) → +X (right) → −Z (front) → −X (left).
    wrap = stitch_wrap([
        crops["back"],
        crops["right"],
        front_band,
        crops["left"],
    ])
    # Roll −1/8 turn so each 90° panel is centred on an axis (front at u=0.5 / −Z).
    wrap = np.roll(wrap, -wrap.shape[1] // 8, axis=1)
    hsv_w = cv2.cvtColor(wrap, cv2.COLOR_RGB2HSV)
    # Front panel centred on u=0.5 after the −1/8 roll.
    x0 = wrap.shape[1] // 2 - wrap.shape[1] // 8
    x1 = wrap.shape[1] // 2 + wrap.shape[1] // 8
    bright = (hsv_w[:, x0:x1, 2] >= 180) & (hsv_w[:, x0:x1, 1] <= 70)
    if float(bright.mean()) < 0.008:
        raise SystemExit(f"front wrap lost white print ({bright.mean():.4f})")
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

    write_powder_maps(paths["powder_macro"])
    with open(os.path.join(PHOTOS, "measure.json"), "w") as f:
        json.dump(measures, f, indent=2)


def _median_rgb(rgb: np.ndarray) -> list[int]:
    flat = rgb.reshape(-1, rgb.shape[-1])[:, :3]
    return [int(v) for v in np.median(flat, axis=0)]


def write_powder_maps(macro_path: str) -> None:
    crumb_path = os.path.join(OUT, "creatine_crumb.png")
    before = imread_rgb(crumb_path) if os.path.isfile(crumb_path) else None
    before_med = _median_rgb(before) if before is not None else None
    detail, lifted = powder_tile(macro_path)
    save(lifted, crumb_path)
    save(normal_map(detail, strength=2.8), os.path.join(OUT, "creatine_crumb_normal.png"))
    save(roughness_map(detail), os.path.join(OUT, "creatine_crumb_rough.png"))
    rgb_med = median_color(lifted, crop=0.35)
    after_med = _median_rgb(lifted)
    manifest_path = os.path.join(OUT, "textures.json")
    meta = {}
    if os.path.isfile(manifest_path):
        with open(manifest_path) as f:
            meta = json.load(f)
    meta.update({
        "label_wrap": meta.get("label_wrap", "creatine/label_wrap.jpg?v=kfd-whiteprint1"),
        "lid_top": meta.get("lid_top", "creatine/lid_top.png"),
        "lid_underside": meta.get("lid_underside", "creatine/lid_underside.png"),
        "well": meta.get("well", "creatine/well.png"),
        "bottom": meta.get("bottom", "creatine/bottom.png"),
        "creatine_crumb": "creatine/creatine_crumb.png?v=lift2",
        "creatine_crumb_normal": "creatine/creatine_crumb_normal.png?v=lift2",
        "creatine_crumb_rough": "creatine/creatine_crumb_rough.png?v=lift2",
        "creatine_median_rgb": rgb_med,
        "creatine_median_hex": "#%02x%02x%02x" % tuple(rgb_med),
    })
    with open(manifest_path, "w") as f:
        json.dump(meta, f, indent=2)
    print("crumb median before", before_med)
    print("crumb median after", after_med, meta["creatine_median_hex"])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--powder-only":
        os.makedirs(OUT, exist_ok=True)
        write_powder_maps(os.path.join(PHOTOS, "powder_macro.jpg"))
    else:
        main()
