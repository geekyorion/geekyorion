"""
Bake public/face.bin from local portraits (private/, never committed).

1. Every photo's 478 MediaPipe landmarks (pixel x, y and relative depth z) are
   similarity-aligned (Umeyama) to the reference frame of the studio portrait,
   and their median gives a consensus 3D shape of the face.
2. The texture photo is mapped onto that shape: inside the landmark hull, depth
   comes from a Delaunay interpolation of the consensus mesh; hair, ears, neck
   and collar use a head/neck proxy that is continuous with the mesh.
3. Every textured pixel then goes through the texture-to-reference similarity,
   which also undoes the photo's head tilt, into the 1024 px reference frame
   the runtime works in.
4. A shuffled pool of points is importance-sampled (uniform coverage + edge
   boost). Any prefix of the pool is an even subsample of the head.

Output (little endian): 'GFB1', u32 count, u32 jsonLen, json (landmarks),
padding to 4 bytes, then u16 u*32 | u16 v*32 | i16 z*16 | u8 rgb | u8 class.
No image is written, only sampled points.

usage: python3 tools/bake_face.py <texture-name> <out.bin> [preview.png]
"""
import base64, glob, json, struct, sys
import numpy as np
from PIL import Image, ImageOps
from scipy.spatial import Delaunay
from scipy import ndimage

REF = 'studio'
POOL = 64000
STABLE = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 93, 234, 127, 162, 21, 54, 103, 67, 109,
          151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 33, 133, 263, 362, 70, 105, 107, 300, 334, 336]

texture_name, out_path = sys.argv[1], sys.argv[2]
preview_path = sys.argv[3] if len(sys.argv) > 3 else None


def load(name):
    d = json.load(open(f'private/detect/{name}.json'))
    P = np.array(d['landmarks'], np.float64) * np.array([d['w'], d['h'], d['w']])
    mask = np.frombuffer(base64.b64decode(d['mask']['b64']), np.uint8).reshape(d['mask']['h'], d['mask']['w'])
    return d, P, mask


def umeyama(src, dst):
    """Similarity (s, R, t) minimising |s R src + t - dst|."""
    ms, md = src.mean(0), dst.mean(0)
    A, B = src - ms, dst - md
    U, S, Vt = np.linalg.svd(B.T @ A / len(src))
    D = np.eye(3)
    if np.linalg.det(U @ Vt) < 0:
        D[2, 2] = -1
    R = U @ D @ Vt
    s = np.trace(np.diag(S) @ D) / (A ** 2).sum(1).mean()
    return s, R, md - s * R @ ms


# ---------------------------------------------------------------- 1. consensus shape
names = [f.split('/')[-1][:-5] for f in sorted(glob.glob('private/detect/*.json'))]
_, P_ref, _ = load(REF)
aligned = []
for n in names:
    _, P, _ = load(n)
    s, R, t = umeyama(P[STABLE], P_ref[STABLE])
    aligned.append((s * (R @ P.T)).T + t)
consensus = np.median(np.stack(aligned), axis=0)
spread = np.stack(aligned).std(0)[:, 2].mean()
print(f'consensus from {len(names)} photos, mean depth spread {spread:.1f}px')

# ---------------------------------------------------------------- 2. texture photo
d, P_tex, mask_small = load(texture_name)
img = np.asarray(ImageOps.exif_transpose(Image.open(glob.glob(f'private/{texture_name}.*')[0])).convert('RGB'), np.float32)
H, W = img.shape[:2]
mask = np.asarray(Image.fromarray(mask_small).resize((W, H), Image.NEAREST))

# close small gaps between hair and skin (background peeking between strands and cheek):
# gap pixels become hair, coloured like their nearest real hair/skin pixel
union = np.isin(mask, [1, 2, 3])
gap = ndimage.binary_closing(union, iterations=8) & ~union
if gap.any():
    _, (iy, ix) = ndimage.distance_transform_edt(~union, return_indices=True)
    mask = mask.copy()
    img = img.copy()
    mask[gap] = mask[iy[gap], ix[gap]]
    img[gap] = img[iy[gap], ix[gap]]
    print(f'filled {gap.sum()} gap pixels')

s, R, t = umeyama(P_tex[STABLE], P_ref[STABLE])            # texture -> reference
Rinv = R.T
cons_tex = ((Rinv @ (consensus - t).T) / s).T                # consensus seen from the texture camera

# head/neck proxy in texture space, built from the consensus mesh
left, right = cons_tex[234], cons_tex[454]
hw = np.linalg.norm(right[:2] - left[:2]) / 2
cx = (left[0] + right[0]) / 2
cz = (left[2] + right[2]) / 2
cy = cons_tex[168][1] + 0.1 * hw
rx, ry, rz = hw * 1.06, hw * 1.42, cz - cons_tex[10][2]

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
ex = (xs - cx) / rx
ey = (ys - cy) / ry
e = 1 - ex ** 2 - ey ** 2
z_head = np.where(e > 0, cz - rz * np.sqrt(np.clip(e, 0, 1)), cz)
nx = np.clip((xs - cx) / (hw * 0.62), -1, 1)
z_neck = cz - hw * 0.62 * np.sqrt(1 - nx ** 2) * 0.85
tx = np.clip((xs - cx) / (hw * 2.4), -1, 1)
z_body = cz - hw * 0.95 * np.sqrt(1 - tx ** 2)

# mesh depth inside the landmark hull
tri = Delaunay(P_tex[:, :2])
simplex = tri.find_simplex(np.stack([xs.ravel(), ys.ravel()], 1)).reshape(H, W)
inside = simplex >= 0
z_mesh = np.zeros((H, W), np.float32)
idx = np.nonzero(inside)
T = tri.transform[simplex[idx]]
bary2 = np.einsum('nij,nj->ni', T[:, :2], np.stack([xs[idx], ys[idx]], 1) - T[:, 2])
bary = np.concatenate([bary2, 1 - bary2.sum(1, keepdims=True)], 1)
z_mesh[idx] = (bary * cons_tex[tri.simplices[simplex[idx]], 2]).sum(1)

# first-pass proxy depth, only used to place pixels in the reference frame
edge = inside & ~ndimage.binary_erosion(inside, iterations=4)
offset = float(np.median(z_mesh[edge] - z_head[edge]))
feather = ndimage.gaussian_filter(inside.astype(np.float32), float(hw * 0.12))
cls = mask
z0 = np.where(inside, feather * z_mesh + (1 - feather) * (z_head + offset), z_head + offset)

def to_ref(zmap):
    pts = np.stack([xs, ys, zmap], -1).reshape(-1, 3)
    ref = (s * (R @ pts.T)).T + t
    return ref[:, 0].reshape(H, W), ref[:, 1].reshape(H, W), ref[:, 2].reshape(H, W)

U, V, Z0 = to_ref(z0)
Zmesh = to_ref(z_mesh)[2]

# landmarks in the reference frame: texture x/y, consensus depth
Lc = (s * (R @ np.stack([P_tex[:, 0], P_tex[:, 1], cons_tex[:, 2]], 1).T)).T + t
hw_ref = np.linalg.norm(Lc[454, :2] - Lc[234, :2]) / 2

# ---------------------------------------------------------------- 3. the lathe: a closed head from the silhouette
# Each 2 px row of the reference frame is an ellipse: half-width a(v) from the
# real outline (hair + skin), front radius from the face mesh, rounder back.
body = np.isin(cls, [1, 2, 3]) & ~((cls == 2) & (np.abs(U - 512) > 190))
ROW = 2
rows = np.arange(0, 1024, ROW)
vi = np.clip((V / ROW).astype(int), 0, len(rows) - 1)
umin = np.full(len(rows), np.nan); umax = np.full(len(rows), np.nan)
for r_ in range(len(rows)):
    sel = body & (vi == r_)
    if sel.sum() > 30:
        uu = U[sel]
        umin[r_], umax[r_] = np.percentile(uu, 1), np.percentile(uu, 99)
valid = ~np.isnan(umin)
top_row, bot_row = np.nonzero(valid)[0][[0, -1]]
def fill_smooth(arr, sigma):
    idx = np.arange(len(arr)); ok = ~np.isnan(arr)
    out = np.interp(idx, idx[ok], arr[ok])
    return ndimage.gaussian_filter1d(out, sigma)
cxv = fill_smooth((umin + umax) / 2, 4)
av = fill_smooth((umax - umin) / 2, 3)
z_axis = float((Lc[234, 2] + Lc[454, 2]) / 2 + 0.25 * hw_ref)
chin_v, neck_v = Lc[152, 1], Lc[152, 1] + 60

# front radius: from the mesh where the face is, rounder elsewhere
zf = np.full(len(rows), np.nan)
for r_ in range(len(rows)):
    sel = inside & (vi == r_) & (np.abs(U - cxv[r_]) < av[r_] * 0.35)
    if sel.sum() > 20:
        zf[r_] = np.percentile(Zmesh[sel], 50)
bf_mesh = z_axis - zf
bf_round = av * np.where(rows < chin_v, 1.0, 0.9)
bf = np.where(np.isnan(bf_mesh), bf_round, np.maximum(bf_mesh, bf_round * 0.7))
bf = ndimage.gaussian_filter1d(bf, 6)
bb = av * np.where(rows < chin_v, 1.12, 0.92)
bb = ndimage.gaussian_filter1d(bb, 6)

def lathe_front_z(u, v):
    r_ = np.clip((v / ROW).astype(int), 0, len(rows) - 1)
    x = np.clip((u - cxv[r_]) / np.maximum(av[r_], 1), -1, 1)
    return z_axis - bf[r_] * np.sqrt(1 - x ** 2)

# final depth for photo pixels: mesh inside the hull, lathe outside, feathered
Zl = lathe_front_z(U, V)
Z = np.where(inside, feather * Zmesh + (1 - feather) * Zl, Zl)
Z = np.where(cls == 4, np.minimum(Zl, z_axis - av[np.clip((V / ROW).astype(int), 0, len(rows) - 1)] * 0.6), Z)

# which pixels become particles
keep = np.isin(cls, [1, 2, 3, 4]) & (V < 880) & (V > 20)
keep &= ~((cls == 2) & (np.abs(U - 512) > 190))     # arms
keep &= ~((cls == 4) & (np.abs(U - 512) > 430))
keep &= ~((cls == 4) & (V < 640))
# grazing pixels at the silhouette are better served by the lathe sides
xr = np.abs(U - cxv[np.clip((V / ROW).astype(int), 0, len(rows) - 1)]) / np.maximum(av[np.clip((V / ROW).astype(int), 0, len(rows) - 1)], 1)
keep &= ~((cls != 3) & (xr > 0.97))

# normals of the photo surface (tangents of the pixel -> reference map)
tU = np.stack([np.gradient(U, axis=1), np.gradient(V, axis=1), np.gradient(Z, axis=1)], -1)
tV = np.stack([np.gradient(U, axis=0), np.gradient(V, axis=0), np.gradient(Z, axis=0)], -1)
Nmap = np.cross(tU, tV)
Nmap /= np.linalg.norm(Nmap, axis=-1, keepdims=True) + 1e-9
Nmap *= np.where(Nmap[..., 2:3] > 0, -1, 1)   # face the camera (-z)

# ---------------------------------------------------------------- 4. importance sampling of the photo
lum = img @ np.array([0.299, 0.587, 0.114], np.float32) / 255
gy, gx = np.gradient(ndimage.gaussian_filter(lum, 1.2))
edge_mag = np.clip(np.hypot(gx, gy) * 18, 0, 1)
region = np.select([cls == 3, cls == 1, cls == 2, cls == 4], [1.25, 1.0, 0.8, 0.35], 0)
fade = 1 - np.clip((V - 720) / 160, 0, 1)
# steep surfaces (nose sides, cheek edges) cover more 3D area per photo pixel: give them more points
stretch = np.clip(1 / np.maximum(np.abs(Nmap[..., 2]), 1e-3), 1, 3)
weight = np.where(keep, (1 + 1.1 * edge_mag) * region * (0.3 + 0.7 * fade) * stretch, 0).astype(np.float64)
rng = np.random.default_rng(7)
# Blue-noise sampling: expected counts per k x k cell, then 1D error diffusion along a
# serpentine walk of the cells. Points end up evenly spaced, with no clumps or slits.
kept = weight > 0
k = max(2, int(round(np.sqrt(kept.sum() / POOL))))
Hc, Wc = H // k, W // k
cellw = weight[:Hc * k, :Wc * k].reshape(Hc, k, Wc, k).sum((1, 3))
expected = cellw / cellw.sum() * POOL
order = expected.copy()
order[1::2] = order[1::2, ::-1]
C = np.cumsum(order.ravel())
counts = np.diff(np.floor(np.concatenate([[0.0], C]))).astype(int).reshape(Hc, Wc)
counts[1::2] = counts[1::2, ::-1]
cy_, cx_ = np.nonzero(counts)
reps = counts[cy_, cx_]
cy_, cx_ = np.repeat(cy_, reps), np.repeat(cx_, reps)
M = len(cy_)
py = cy_ * k + rng.integers(0, k, M)
px_ = cx_ * k + rng.integers(0, k, M)
for _ in range(8):  # re-draw points that fell on unused pixels inside an edge cell
    bad = weight[py, px_] <= 0
    if not bad.any():
        break
    py[bad] = cy_[bad] * k + rng.integers(0, k, bad.sum())
    px_[bad] = cx_[bad] * k + rng.integers(0, k, bad.sum())
ok = weight[py, px_] > 0
py, px_ = py[ok], px_[ok]
POOL = len(py)
print(f'blue-noise pool: {POOL} points, cell {k}px')
jx, jy = rng.random(POOL) - 0.5, rng.random(POOL) - 0.5
at = lambda arr: arr[py, px_]
u = at(U) + jx * at(np.gradient(U, axis=1)) + jy * at(np.gradient(U, axis=0))
v = at(V) + jx * at(np.gradient(V, axis=1)) + jy * at(np.gradient(V, axis=0))
zz = at(Z) + np.where(at(cls) == 1, rng.normal(0, hw_ref * 0.02, POOL), 0)
nrm = at(Nmap)

# exposure: match the median face-skin brightness of the reference portrait
ref_img = np.asarray(Image.open(glob.glob(f'private/{REF}.*')[0]).convert('RGB'), np.float32)
_, _, ref_mask = load(REF)
ref_skin = np.median(ref_img[np.asarray(Image.fromarray(ref_mask).resize(ref_img.shape[1::-1], Image.NEAREST)) == 3] @ [0.299, 0.587, 0.114])
tex_skin = np.median(img[cls == 3] @ [0.299, 0.587, 0.114])
gain = float(np.clip(ref_skin / tex_skin, 0.8, 1.8))
print(f'exposure gain {gain:.2f}')
rgb = np.clip(at(img) * gain, 0, 255)
kls = at(cls).astype(np.uint8)

# ---------------------------------------------------------------- 5. sides and back of the head
# Strand colours come from the outer band of the photo on the same row and side.
band = keep & np.isin(cls, [1, 2]) & (xr > 0.72)
band_rows = {}
bi = np.nonzero(band)
for yy, xx in zip(*bi):
    key = (int(V[yy, xx] / 8), U[yy, xx] > cxv[int(V[yy, xx] / ROW)])
    band_rows.setdefault(key, []).append((yy, xx))
density = POOL / float(((weight > 0) & (cls != 4)).sum() * s * s)   # points per reference px^2
back_pts = []
for r_ in range(top_row, min(bot_row, int(880 / ROW))):
    vv = rows[r_]
    a, rf, rb, cx_ = av[r_], bf[r_], bb[r_], cxv[r_]
    if a < 4:
        continue
    th = np.linspace(np.radians(62), np.pi, 64)
    rr = np.where(np.cos(th) > 0, rf, rb)
    ds = np.hypot(a * np.cos(th), rr * np.sin(th)) * (th[1] - th[0])
    count = rng.poisson(density * ds.sum() * ROW * 2 * 0.5)
    for _ in range(count):
        side = rng.random() < 0.5
        t_ = rng.choice(th, p=ds / ds.sum()) + rng.normal(0, 0.01)
        sgn = 1 if side else -1
        rad = rf if np.cos(t_) > 0 else rb
        x = cx_ + sgn * a * np.sin(t_)
        z = z_axis - rad * np.cos(t_) + rng.normal(0, hw_ref * 0.015)
        y = vv + rng.random() * ROW
        lst = band_rows.get((int(y / 8), side)) or band_rows.get((int(y / 8) - 1, side)) or band_rows.get((int(y / 8) + 1, side))
        if not lst:
            continue
        yy, xx = lst[rng.integers(len(lst))]
        k = cls[yy, xx]
        shade = 0.9 - 0.3 * max(0.0, (t_ - np.pi / 2) / (np.pi / 2))
        c = np.clip(img[yy, xx] * gain * shade, 0, 255)
        n = np.array([sgn * np.sin(t_) / a, 0, -np.cos(t_) / rad]); n /= np.linalg.norm(n)
        back_pts.append((x, y, z, *c, 5 if k == 1 else 7, *n))
back = np.array(back_pts, np.float64)
print(f'lathe sides/back: {len(back)} points, axis z {z_axis:.0f}, rows {rows[top_row]}..{rows[bot_row]}')

# ---------------------------------------------------------------- 6. mouth interior (shown when the jaw opens)
mL, mR = Lc[61], Lc[291]
mc = (Lc[13] + Lc[14]) / 2
MI = 5200
ang = rng.random(MI) * 2 * np.pi
rad = np.sqrt(rng.random(MI))
half = abs(mR[0] - mL[0]) / 2
mu = mc[0] + np.cos(ang) * rad * (half + 8)
mv = mc[1] + 10 + np.sin(ang) * rad * 34
mz = np.full(MI, mc[2] + hw_ref * 0.12) + rng.normal(0, 1.5, MI)
central = np.abs(mu - mc[0]) < half * 0.62
upper_teeth = central & (mv > mc[1] - 10) & (mv < mc[1] + 3)
lower_teeth = central & (mv > mc[1] + 5) & (mv < mc[1] + 12)
mcol = np.select([upper_teeth[:, None], lower_teeth[:, None]], [[[156, 148, 138]], [[118, 110, 102]]], [[40, 13, 15]])
mcol = mcol * (0.96 + 0.08 * rng.random((MI, 1)))
# the cavity darkens towards the back of the throat
mcol = np.where((upper_teeth | lower_teeth)[:, None], mcol, mcol * (1 - 0.5 * np.clip(rad[:, None], 0, 1)))
interior = np.column_stack([mu, mv, mz, mcol, np.full(MI, 6), np.zeros((MI, 2)), -np.ones(MI)])

# ---------------------------------------------------------------- assemble: interior first (drawn first), rest shuffled
photo = np.column_stack([u, v, zz, rgb, kls, nrm])
rest = np.concatenate([photo, back]) if len(back) else photo
rest = rest[rng.permutation(len(rest))]
allp = np.concatenate([interior, rest])
N = len(allp)

# ---------------------------------------------------------------- landmarks (texture features, reference frame)
L = Lc
pt = lambda i: {'x': round(float(L[i][0]), 1), 'y': round(float(L[i][1]), 1)}
mid = lambda a, b: {'x': round(float((L[a][0] + L[b][0]) / 2), 1), 'y': round(float((L[a][1] + L[b][1]) / 2), 1)}
lm = {
    'size': 1024,
    'center': {'x': 512, 'y': 470},
    'eyeL': pt(468), 'eyeR': pt(473),
    'eyeHalfW': round(float(np.linalg.norm(L[33][:2] - L[133][:2]) / 2), 1),
    'eyeHalfH': round(float(max(12, np.linalg.norm(L[159][:2] - L[145][:2]) * 0.9)), 1),
    'browL': pt(105), 'browR': pt(334),
    'noseTip': pt(1),
    'mouth': mid(13, 14), 'mouthL': pt(61), 'mouthR': pt(291),
    'chin': pt(152),
    'zNose': round(float(L[1][2]), 1),
    'axisZ': round(z_axis, 1),
    'source': {'photos': len(names), 'texture': 'selfie', 'depthSpread': round(float(spread), 2)},
}
print(json.dumps(lm))
tri_ref = Delaunay(Lc[:, :2]).simplices.astype('<u2')

# ---------------------------------------------------------------- write (v2)
js = json.dumps(lm).encode()
head = b'GFB2' + struct.pack('<II', N, len(js)) + js
head += b'\0' * (-len(head) % 4)
head += Lc.astype('<f4').tobytes() + struct.pack('<I', len(tri_ref)) + tri_ref.tobytes()
head += b'\0' * (-len(head) % 4)
cu, cvv, czz = allp[:, 0], allp[:, 1], allp[:, 2]
body = (np.clip(cu * 32, 0, 65535).astype('<u2').tobytes() + np.clip(cvv * 32, 0, 65535).astype('<u2').tobytes()
        + np.clip(czz * 16, -32768, 32767).astype('<i2').tobytes() + np.clip(allp[:, 3:6], 0, 255).astype(np.uint8).tobytes()
        + allp[:, 6].astype(np.uint8).tobytes() + np.clip(allp[:, 7:10] * 127, -127, 127).astype(np.int8).tobytes())
open(out_path, 'wb').write(head + body)
print(f'wrote {out_path}: {N} points ({MI} interior, {len(back)} lathe), {len(head) + len(body)} bytes, tris {len(tri_ref)}')

if preview_path:
    # private sanity check: front, side and back views of the baked points
    canvas = np.zeros((1024, 3072, 3), np.uint8)
    def splat(xs_, ys_, depth, ox):
        for k in np.argsort(-depth):
            x, y = int(xs_[k] + ox), int(ys_[k])
            if ox <= x < ox + 1024 and 0 <= y < 1024:
                canvas[y, x] = allp[k, 3:6]
    vis = allp[:, 6] != 6
    P3 = allp[vis]
    allp = P3
    splat(P3[:, 0], P3[:, 1], P3[:, 2], 0)                                          # front (camera at -z)
    splat(512 + (P3[:, 2] - z_axis), P3[:, 1], P3[:, 0], 1024)                      # side, from screen-left
    splat(1024 - P3[:, 0], P3[:, 1], -P3[:, 2], 2048)                               # back
    Image.fromarray(canvas).save(preview_path)
