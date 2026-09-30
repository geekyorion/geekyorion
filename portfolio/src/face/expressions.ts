import { SHAPES } from '../engine/types';
import { damp } from '../math';
import { BS } from './landmarks';

type Name = keyof typeof BS;
type Preset = Partial<Record<Name, number>> & { head?: [number, number, number] };

export const EXPRESSIONS = {
  neutral: {},
  smile: { SmileL: 1, SmileR: 1 },
  laugh: { SmileL: 1, SmileR: 1, JawOpen: 0.55, BrowUp: 0.3 },
  surprised: { BrowUp: 1, JawOpen: 0.85, EyeWide: 1 },
  angry: { BrowDown: 1, Frown: 0.7, BlinkL: 0.2, BlinkR: 0.2 },
  sad: { Frown: 1, BrowUp: 0.45, BlinkL: 0.25, BlinkR: 0.25, head: [0, 0.12, 0] },
  wink: { BlinkR: 1, SmileL: 0.35, SmileR: 1, head: [0, 0, -0.06] },
  skeptic: { BrowRaiseL: 1, SmileR: 0.55, BlinkR: 0.25, head: [0.05, 0, 0.05] },
  sleepy: { BlinkL: 0.8, BlinkR: 0.8, JawOpen: 0.12, head: [0, 0.1, 0.08] },
  thinking: { BrowRaiseL: 0.6, Frown: 0.25, LookY: -0.9, LookX: -0.7, head: [-0.08, -0.08, 0] },
} satisfies Record<string, Preset>;

export type ExpressionName = keyof typeof EXPRESSIONS;
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as ExpressionName[];

/**
 * Drives the 12 blendshape weights: preset targets, smoothing, automatic
 * blinking, gaze that follows the pointer, fake lip-sync, and an external
 * override (webcam mirror mode).
 */
export class ExpressionAnimator {
  readonly weights = new Float32Array(SHAPES);
  readonly head = [0, 0, 0];
  current: ExpressionName = 'neutral';
  private target = new Float32Array(SHAPES);
  private presetHead = [0, 0, 0];
  private nextBlink = 2;
  private blinkT = -1;
  private talkUntil = 0;
  private revertAt = 0;
  private revertTo: ExpressionName = 'neutral';
  private gaze = [0, 0];
  /** When set (mirror mode), these weights are used as-is. */
  external: { weights: Float32Array; head: [number, number, number] } | null = null;

  set(name: ExpressionName, holdSeconds = 0, time = 0) {
    this.current = name;
    this.target.fill(0);
    const p = EXPRESSIONS[name] as Preset;
    for (const [k, v] of Object.entries(p)) if (k !== 'head') this.target[BS[k as Name]] = v as number;
    const h = p.head ?? [0, 0, 0];
    this.presetHead = [...h];
    if (holdSeconds > 0) {
      this.revertAt = time + holdSeconds;
    } else {
      this.revertAt = 0;
      this.revertTo = name;
    }
  }

  /** Base expression to return to after a temporary one. */
  setResting(name: ExpressionName, time: number) {
    this.revertTo = name;
    if (!this.revertAt) this.set(name, 0, time);
  }

  talk(seconds: number, time: number) {
    this.talkUntil = Math.max(this.talkUntil, time + seconds);
  }

  update(time: number, dt: number, gazeX: number, gazeY: number) {
    if (this.revertAt && time > this.revertAt) {
      this.revertAt = 0;
      this.set(this.revertTo, 0, time);
    }

    if (this.external) {
      const k = damp(20, dt);
      for (let i = 0; i < SHAPES; i++) this.weights[i] += (this.external.weights[i] - this.weights[i]) * k;
      for (let i = 0; i < 3; i++) this.head[i] += (this.external.head[i] - this.head[i]) * k;
      return;
    }

    const k = damp(9, dt);
    for (let i = 0; i < SHAPES; i++) this.weights[i] += (this.target[i] - this.weights[i]) * k;

    // gaze follows the pointer, with a slight lag
    const kg = damp(14, dt);
    this.gaze[0] += (gazeX - this.gaze[0]) * kg;
    this.gaze[1] += (gazeY - this.gaze[1]) * kg;
    if (!(EXPRESSIONS[this.current] as Preset).LookX) {
      this.weights[BS.LookX] = this.gaze[0];
      this.weights[BS.LookY] = this.gaze[1];
    }

    // automatic blinking: a quick 160 ms close/open envelope
    if (time > this.nextBlink && this.blinkT < 0) this.blinkT = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = Math.sin(Math.min(1, this.blinkT / 0.16) * Math.PI);
      this.weights[BS.BlinkL] = Math.max(this.weights[BS.BlinkL], b);
      this.weights[BS.BlinkR] = Math.max(this.weights[BS.BlinkR], b);
      if (this.blinkT > 0.16) {
        this.blinkT = -1;
        this.nextBlink = time + 1.8 + Math.random() * 3.5;
        if (Math.random() < 0.2) this.nextBlink = time + 0.25; // occasional double blink
      }
    }

    // fake lip-sync: layered sines on the jaw while "talking"
    if (time < this.talkUntil) {
      const j = 0.5 + 0.5 * Math.sin(time * 19) * Math.sin(time * 7.3 + 1.1);
      this.weights[BS.JawOpen] = Math.max(this.weights[BS.JawOpen], j * 0.45);
    }

    // idle head sway + preset head pose
    const kh = damp(4, dt);
    const idle = [Math.sin(time * 0.37) * 0.03, Math.sin(time * 0.29 + 1) * 0.02, Math.sin(time * 0.23) * 0.015];
    for (let i = 0; i < 3; i++) this.head[i] += (this.presetHead[i] + idle[i] - this.head[i]) * kh;
  }
}
