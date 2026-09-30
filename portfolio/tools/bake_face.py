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

# proxy offset so the proxy meets the mesh at the hull boundary, then feather across it
edge = inside & ~ndimage.binary_erosion(inside, iterations=4)
offset = float(np.median(z_mesh[edge] - z_head[edge]))
feather = ndimage.gaussian_filter(inside.astype(np.float32), float(hw * 0.12))
cls = mask
# hair: a bigger, rounder shell so hair outside the skull silhouette still curves back
hx = (xs - cx) / (rx * 1.35)
hy = (ys - cy) / (ry * 1.18)
he = np.clip(1 - hx ** 2 - hy ** 2, 0, 1)
z_hair = cz + offset * 0.5 - (rz * 1.05) * np.sqrt(he) - hw * 0.05
z_proxy = np.where(cls == 1, np.minimum(z_hair, z_head + offset - hw * 0.05), z_head + offset)
z_proxy = np.where(cls == 2, np.minimum(z_neck, z_head + offset), z_proxy)
z_proxy = np.where(cls == 4, np.minimum(z_body, z_neck), z_proxy)
z = np.where(inside, feather * z_mesh + (1 - feather) * z_proxy, z_proxy)

# ---------------------------------------------------------------- 3. into the reference frame
pts = np.stack([xs, ys, z], -1).reshape(-1, 3)
ref = (s * (R @ pts.T)).T + t
U = ref[:, 0].reshape(H, W)
V = ref[:, 1].reshape(H, W)
Z = ref[:, 2].reshape(H, W)

# which pixels become particles
keep = np.isin(cls, [1, 2, 3, 4]) & (V < 880) & (V > 20)
keep &= ~((cls == 2) & (np.abs(U - 512) > 190))     # arms
keep &= ~((cls == 4) & (np.abs(U - 512) > 430))
keep &= ~((cls == 4) & (V < 640))

# ---------------------------------------------------------------- 4. importance sampling
lum = img @ np.array([0.299, 0.587, 0.114], np.float32) / 255
gy, gx = np.gradient(ndimage.gaussian_filter(lum, 1.2))
edge_mag = np.clip(np.hypot(gx, gy) * 18, 0, 1)
region = np.select([cls == 3, cls == 1, cls == 2, cls == 4], [1.25, 1.0, 0.8, 0.35], 0)
fade = 1 - np.clip((V - 720) / 160, 0, 1)
weight = np.where(keep, (1 + 1.1 * edge_mag) * region * (0.3 + 0.7 * fade), 0).astype(np.float64)
flat = weight.ravel()
cdf = np.cumsum(flat)
rng = np.random.default_rng(7)
r = (np.arange(POOL) + rng.random(POOL)) / POOL * cdf[-1]
pick = np.searchsorted(cdf, r)
rng.shuffle(pick)
py, px_ = np.divmod(pick, W)
jx, jy = rng.random(POOL) - 0.5, rng.random(POOL) - 0.5

# sub-pixel position through the same mapping (bilinear via neighbour deltas)
def at(arr):
    return arr[py, px_]
dUx = np.gradient(U, axis=1)[py, px_]; dVx = np.gradient(V, axis=1)[py, px_]
dUy = np.gradient(U, axis=0)[py, px_]; dVy = np.gradient(V, axis=0)[py, px_]
u = at(U) + jx * dUx + jy * dUy
v = at(V) + jx * dVx + jy * dVy
zz = at(Z)
# hair gets a little random depth so it reads as volume, not a sheet
zz = zz + np.where(cls[py, px_] == 1, rng.normal(0, hw * s * 0.035, POOL), 0)

# exposure: match the median face-skin brightness of the reference portrait
ref_img = np.asarray(Image.open(glob.glob(f'private/{REF}.*')[0]).convert('RGB'), np.float32)
_, _, ref_mask = load(REF)
ref_skin = np.median(ref_img[np.asarray(Image.fromarray(ref_mask).resize(ref_img.shape[1::-1], Image.NEAREST)) == 3] @ [0.299, 0.587, 0.114])
tex_skin = np.median(img[cls == 3] @ [0.299, 0.587, 0.114])
gain = float(np.clip(ref_skin / tex_skin, 0.8, 1.8))
print(f'exposure gain {gain:.2f} (skin {tex_skin:.0f} -> {ref_skin:.0f})')
rgb = np.clip(img[py, px_] * gain, 0, 255).astype(np.uint8)
kls = cls[py, px_].astype(np.uint8)

# ---------------------------------------------------------------- landmarks (texture features, reference frame)
L = (s * (R @ P_tex.T)).T + t
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
    'source': {'photos': len(names), 'texture': 'selfie', 'depthSpread': round(float(spread), 2)},
}
print(json.dumps(lm))

# ---------------------------------------------------------------- write
js = json.dumps(lm).encode()
head = b'GFB1' + struct.pack('<II', POOL, len(js)) + js
head += b'\0' * (-len(head) % 4)
body = (np.clip(u * 32, 0, 65535).astype('<u2').tobytes() + np.clip(v * 32, 0, 65535).astype('<u2').tobytes()
        + np.clip(zz * 16, -32768, 32767).astype('<i2').tobytes() + rgb.tobytes() + kls.tobytes())
open(out_path, 'wb').write(head + body)
print(f'wrote {out_path}: {POOL} points, {len(head) + len(body)} bytes, u {u.min():.0f}..{u.max():.0f} v {v.min():.0f}..{v.max():.0f} z {zz.min():.0f}..{zz.max():.0f}')

if preview_path:
    # private sanity check: front + side view of the baked points
    canvas = np.zeros((1024, 2048, 3), np.uint8)
    order = np.argsort(-zz)
    for k in order:
        x, y = int(u[k]), int(v[k])
        if 0 <= x < 1024 and 0 <= y < 1024:
            canvas[y, x] = rgb[k]
    for k in np.argsort(u):
        x, y = int(1536 + (zz[k] - lm['zNose']) * 1.0 - 150), int(v[k])
        if 1024 <= x < 2048 and 0 <= y < 1024:
            canvas[y, x] = rgb[k]
    Image.fromarray(canvas).save(preview_path)
