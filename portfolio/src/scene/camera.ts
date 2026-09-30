import { damp, lookAt, multiply, normalize, perspective, type Vec3 } from '../math';

const FOV = 0.6;

/**
 * Camera with a little pointer parallax, plus the pointer ray the particle
 * shader uses for its force field.
 */
export class Camera {
  eye: Vec3 = [0, 0, 5.2];
  viewProj = new Float32Array(16);
  proj11 = 1;
  rayO: Vec3 = [0, 0, 5.2];
  rayD: Vec3 = [0, 0, -1];
  /** pointer position on the z=0 plane, and its velocity */
  hit: Vec3 = [0, 0, 0];
  hitVel: Vec3 = [0, 0, 0];
  private parallax = [0, 0];

  update(width: number, height: number, ndcX: number, ndcY: number, dt: number, parallaxAmount: number) {
    const k = damp(3, dt);
    this.parallax[0] += (ndcX * parallaxAmount - this.parallax[0]) * k;
    this.parallax[1] += (ndcY * parallaxAmount - this.parallax[1]) * k;
    this.eye = [this.parallax[0] * 0.35, this.parallax[1] * 0.2, 5.2];

    const aspect = width / height;
    const proj = perspective(FOV, aspect, 0.1, 50);
    const view = lookAt(this.eye, [0, 0, 0]);
    multiply(proj, view.matrix, this.viewProj);
    this.proj11 = proj[5];

    const th = Math.tan(FOV / 2);
    const f = view.forward, r = view.right, u = view.up;
    this.rayO = this.eye;
    this.rayD = normalize([
      f[0] + r[0] * ndcX * th * aspect + u[0] * ndcY * th,
      f[1] + r[1] * ndcX * th * aspect + u[1] * ndcY * th,
      f[2] + r[2] * ndcX * th * aspect + u[2] * ndcY * th,
    ]);
    const t = -this.eye[2] / this.rayD[2];
    const hit: Vec3 = [this.eye[0] + this.rayD[0] * t, this.eye[1] + this.rayD[1] * t, 0];
    if (dt > 0) {
      const kv = damp(12, dt);
      for (let i = 0; i < 3; i++) {
        const v = Math.max(-12, Math.min(12, (hit[i] - this.hit[i]) / dt));
        this.hitVel[i] += (v - this.hitVel[i]) * kv;
      }
    }
    this.hit = hit;
  }

  /** Half-height of the visible area on the z=0 plane, in world units. */
  get halfHeight() {
    return this.eye[2] * Math.tan(FOV / 2);
  }
}
