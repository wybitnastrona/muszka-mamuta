#!/usr/bin/env python3
"""
build_textures.py — automatyczne przygotowanie tekstur dla MUSZKA-MAMUTA.

Zastępuje ręczne zadanie D. Robi:
  1. auto-detekcja i wycięcie opakowania z tła (kontur największego obiektu)
  2. prostowanie perspektywy (4-punktowa transformacja, jeśli obiekt jest przekrzywiony)
  3. skalowanie do potęgi dwójki z zachowaniem proporcji (padding przezroczystością)
  4. z makro twarogu: bezszwowa (tileable) tekstura kruszonki metodą offset + blend
  5. normal map z luminancji (Sobel)
  6. roughness map z lokalnej wariancji
  7. próbkowanie mediany koloru twarogu -> zapis do textures.json

Użycie:
  python build_textures.py --in assets/photos --out assets/textures
"""

import argparse
import json
import os

import cv2
import numpy as np
from PIL import Image


# ---------------------------------------------------------------- utilities

def imread_rgb(path):
    im = Image.open(path).convert("RGB")
    return np.array(im)


def next_pow2(n):
    p = 1
    while p < n:
        p *= 2
    return p


def largest_object_mask(rgb, bg_sample_frac=0.04):
    """Maska największego spójnego obiektu, zakładając jednolite tło przy krawędziach."""
    h, w = rgb.shape[:2]
    s = max(2, int(min(h, w) * bg_sample_frac))
    corners = np.concatenate([
        rgb[:s, :s].reshape(-1, 3), rgb[:s, -s:].reshape(-1, 3),
        rgb[-s:, :s].reshape(-1, 3), rgb[-s:, -s:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0)

    dist = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    thr = max(18.0, float(np.percentile(dist, 55)))
    mask = (dist > thr).astype(np.uint8) * 255

    k = np.ones((9, 9), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=3)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=2)

    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return np.ones((h, w), np.uint8) * 255
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == biggest).astype(np.uint8) * 255


def deskew_to_rect(rgb, mask, pad=0.02):
    """Prostuje obiekt do prostokąta przez minAreaRect + warpPerspective."""
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return rgb, False
    c = max(cnts, key=cv2.contourArea)
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(c)
    # rozszerz prostokąt na zewnątrz, żeby nie obciąć krawędzi obiektu
    rect = ((cx, cy), (rw * (1 + 2 * pad), rh * (1 + 2 * pad)), ang)
    box = cv2.boxPoints(rect).astype(np.float32)

    # uporządkuj: TL, TR, BR, BL
    s = box.sum(axis=1)
    d = np.diff(box, axis=1).ravel()
    src = np.array([box[np.argmin(s)], box[np.argmin(d)],
                    box[np.argmax(s)], box[np.argmax(d)]], np.float32)

    wA = np.linalg.norm(src[2] - src[3])
    wB = np.linalg.norm(src[1] - src[0])
    hA = np.linalg.norm(src[1] - src[2])
    hB = np.linalg.norm(src[0] - src[3])
    W, H = int(max(wA, wB)), int(max(hA, hB))
    if W < 32 or H < 32:
        return rgb, False

    dst = np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(rgb, M, (W, H), flags=cv2.INTER_LANCZOS4), True


def fit_pow2(rgb, target_w=None, target_h=None, bg=(0, 0, 0, 0)):
    """Skaluje z zachowaniem proporcji i dopełnia do potęgi dwójki."""
    h, w = rgb.shape[:2]
    tw = target_w or next_pow2(w)
    th = target_h or next_pow2(h)
    scale = min(tw / w, th / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)

    canvas = np.zeros((th, tw, 4), np.uint8)
    canvas[:, :] = bg
    y0, x0 = (th - nh) // 2, (tw - nw) // 2
    canvas[y0:y0 + nh, x0:x0 + nw, :3] = resized
    canvas[y0:y0 + nh, x0:x0 + nw, 3] = 255
    return canvas


def make_tileable(rgb, size=1024, blend=0.25):
    """Bezszwowa tekstura: offset o połowę + mieszanie szwów gradientem."""
    src = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32)
    half = size // 2
    rolled = np.roll(np.roll(src, half, axis=0), half, axis=1)

    bw = int(size * blend)
    ramp = np.linspace(0.0, 1.0, bw, dtype=np.float32)

    wx = np.ones(size, np.float32)
    wx[:bw] = ramp
    wx[-bw:] = ramp[::-1]
    wy = wx.copy()
    weight = np.minimum(wy[:, None], wx[None, :])[:, :, None]

    out = src * weight + rolled * (1.0 - weight)
    return np.clip(out, 0, 255).astype(np.uint8)


def normal_map(rgb, strength=2.2):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    gray = cv2.GaussianBlur(gray, (0, 0), 1.0)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=5) * strength
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=5) * strength
    nz = np.ones_like(gx)
    n = np.dstack([-gx, -gy, nz])
    n /= (np.linalg.norm(n, axis=2, keepdims=True) + 1e-8)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def roughness_map(rgb, base=0.90, spread=0.10):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    mean = cv2.blur(gray, (9, 9))
    var = cv2.blur(gray * gray, (9, 9)) - mean * mean
    var = np.clip(var / (var.max() + 1e-8), 0, 1)
    r = np.clip(base + (var - 0.5) * 2 * spread, 0, 1)
    return (r * 255).astype(np.uint8)


def median_color(rgb, crop=0.4):
    h, w = rgb.shape[:2]
    ch, cw = int(h * crop), int(w * crop)
    y0, x0 = (h - ch) // 2, (w - cw) // 2
    patch = rgb[y0:y0 + ch, x0:x0 + cw].reshape(-1, 3)
    return [int(v) for v in np.median(patch, axis=0)]


def save(arr, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(arr).save(path, optimize=True)
    print(f"  -> {path}  {arr.shape[1]}x{arr.shape[0]}")


# ---------------------------------------------------------------- pipelines

def process_packaging(src_path, out_path, target=(2048, 1024)):
    print(f"[opakowanie] {os.path.basename(src_path)}")
    rgb = imread_rgb(src_path)
    mask = largest_object_mask(rgb)
    cropped, ok = deskew_to_rect(rgb, mask)
    print(f"  wykryto obiekt, prostowanie: {'tak' if ok else 'pominięte'}, "
          f"po wycięciu {cropped.shape[1]}x{cropped.shape[0]}")
    tw, th = target
    if cropped.shape[0] > cropped.shape[1]:
        tw, th = th, tw
    out = fit_pow2(cropped, tw, th)
    save(out, out_path)
    return out


def process_crumb(src_path, out_dir, size=1024):
    print(f"[kruszonka] {os.path.basename(src_path)}")
    rgb = imread_rgb(src_path)
    h, w = rgb.shape[:2]
    side = min(h, w)
    y0, x0 = (h - side) // 2, (w - side) // 2
    square = rgb[y0:y0 + side, x0:x0 + side]

    albedo = make_tileable(square, size)
    save(albedo, os.path.join(out_dir, "twarog_crumb.png"))
    save(normal_map(albedo), os.path.join(out_dir, "twarog_crumb_normal.png"))
    save(roughness_map(albedo), os.path.join(out_dir, "twarog_crumb_rough.png"))
    return albedo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--front", required=True, help="zdjęcie frontu opakowania")
    ap.add_argument("--back", help="zdjęcie tyłu opakowania")
    ap.add_argument("--crumb", required=True, help="makro powierzchni twarogu")
    ap.add_argument("--curd-ref", help="zdjęcie porcji twarogu (do próbkowania koloru)")
    ap.add_argument("--out", default="assets/textures")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    meta = {}

    front = process_packaging(args.front, os.path.join(args.out, "pack_front.png"))
    meta["pack_front"] = "pack_front.png"

    if args.back:
        process_packaging(args.back, os.path.join(args.out, "pack_back.png"))
        meta["pack_back"] = "pack_back.png"

    crumb = process_crumb(args.crumb, args.out)
    meta["twarog_crumb"] = "twarog_crumb.png"
    meta["twarog_crumb_normal"] = "twarog_crumb_normal.png"
    meta["twarog_crumb_rough"] = "twarog_crumb_rough.png"

    ref = imread_rgb(args.curd_ref) if args.curd_ref else crumb
    rgb_med = median_color(ref)
    meta["curd_median_rgb"] = rgb_med
    meta["curd_median_hex"] = "#%02x%02x%02x" % tuple(rgb_med)

    with open(os.path.join(args.out, "textures.json"), "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"\nmediana koloru twarogu: {meta['curd_median_hex']}  RGB {rgb_med}")
    print(f"manifest -> {os.path.join(args.out, 'textures.json')}")


if __name__ == "__main__":
    main()
