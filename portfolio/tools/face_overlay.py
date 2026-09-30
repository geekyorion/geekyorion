import json, base64, math, glob, sys
import numpy as np
from PIL import Image, ImageOps, ImageDraw
out = sys.argv[1]
tiles = []
for f in sorted(glob.glob('private/detect/*.json')):
    name = f.split('/')[-1][:-5]
    d = json.load(open(f))
    src = glob.glob(f'private/{name}.*')[0]
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    assert im.size == (d['w'], d['h']), (im.size, d['w'], d['h'])
    m = np.array(d['matrix']).reshape(4, 4, order='F')
    R = m[:3, :3]
    yaw = math.degrees(math.atan2(R[0, 2], R[2, 2])); pitch = math.degrees(math.asin(-R[1, 2])); roll = math.degrees(math.atan2(R[1, 0], R[1, 1]))
    L = np.array(d['landmarks'])
    mk = np.frombuffer(base64.b64decode(d['mask']['b64']), np.uint8).reshape(d['mask']['h'], d['mask']['w'])
    print(f"{name:16s} yaw {yaw:6.1f} pitch {pitch:6.1f} roll {roll:6.1f}  mask {mk.shape} classes {np.bincount(mk.ravel(), minlength=6).tolist()}")
    # overlay
    pal = np.array([[0,0,0],[255,80,40],[40,200,255],[255,220,0],[80,255,120],[255,0,255]], np.uint8)
    col = Image.fromarray(pal[mk]).resize(im.size)
    ov = Image.blend(im, col, 0.4)
    dr = ImageDraw.Draw(ov)
    for x, y, z in L:
        dr.ellipse((x*d['w']-2, y*d['h']-2, x*d['w']+2, y*d['h']+2), fill=(255,255,255))
    x0, y0 = L[:, 0].min()*d['w'], L[:, 1].min()*d['h']; x1, y1 = L[:, 0].max()*d['w'], L[:, 1].max()*d['h']
    cx, cy, s = (x0+x1)/2, (y0+y1)/2, max(x1-x0, y1-y0)*1.25
    tiles.append(ov.crop((int(cx-s), int(cy-s*1.1), int(cx+s), int(cy+s*0.9))).resize((400, 400)))
sheet = Image.new('RGB', (400*len(tiles), 400))
for i, t in enumerate(tiles): sheet.paste(t, (400*i, 0))
sheet.save(out)
