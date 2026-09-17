# Scene composite — abandoned

Planar PnP from the A4 sheet on `hero.jpg` was tried as a film-style match-move
(not a reconstruction of the room). The committed solve had **reprojErrorPx = 27.3**
against a **3 px** target, so the 3D board floated on the photographed table.
The result read worse than the procedural Studio kitchen. Studio is the only
scene; the photographs remain in `assets/photos/kitchen/` as reference. The
blurred equirect from IMG_8478–8484 is kept as `scene.environment`
(`public/textures/kitchen/env_512.jpg`, intensity 0.5) so the compound eyes
and PET film still reflect the real kitchen.

This is a negative result, recorded the same way as `path_sign`.

The calibration tool (`?debug=match`), grade overlay (`?debug=grade`),
`camera.json`, and the photo backdrop / lighting modules were removed from
the build.

---

## What was tried (historical)

The still was meant to be a camera-locked backdrop. Board, twaróg, PET film
and fly would sit on a shadow-catcher on the solved table plane.

### Inputs

| File | Role |
| --- | --- |
| `assets/photos/kitchen/hero.jpg` / `hero_calib.jpg` | Same iPhone 17 Pro still, 24 mm eq., 3213×5712, ISO 125, native 9:16 |
| `public/textures/kitchen/hero_2160.jpg` | Web-size backdrop (no longer loaded) |
| `assets/photos/kitchen/hero_alt.jpg` | Second viewpoint, reference only |
| `assets/photos/kitchen/IMG_8478`–`8484.jpg` | Ultra-wide lighting / environment; never the backdrop |
| `public/data/kitchen/camera.json` | Solved pose — **deleted**. Residual 27.3 px |

### Solver

Vertical FOV = `2 atan(18/24)` for a 24 mm-eq. portrait 9:16 frame (principal
point at the image centre); planar homography on y = 0; Gauss–Newton PnP;
landscape A4 (297×210 mm) preferred when residual < 40 px.

Committed solve (hero A4, landscape):

| Field | Value |
| --- | --- |
| `fovVerticalDeg` | 73.740° |
| `position` (mm) | (−336.5, 751.6, −987.4) |
| `reprojErrorPx` | **27.3** (target was 3) |
| `backdropDepthMm` | 2119 (window wall along the look vector) |

### Lighting samples (unused in the live scene)

| Quantity | Sample / setting |
| --- | --- |
| Tabletop sRGB | (196.5, 192.4, 182.7) |
| White balance | Grey-world, G pivot: gain (0.979, 1.000, 1.053) |
| Key | Ceiling track spots in IMG_8479 / IMG_8483, 3000 K, intensity 2.35 |
| Environment | **Kept:** equirect from IMG_8478–8484, 512 px tall, PMREM, intensity 0.5 |
