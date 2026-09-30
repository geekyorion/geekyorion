/**
 * Hand-measured landmarks on the 1024x1024 source portrait (pixel space, y down).
 * Everything else — depth, blendshapes, eye warps — is derived from these.
 */
export const LM = {
  size: 1024,
  center: { x: 512, y: 470 },
  eyeL: { x: 414, y: 398 }, // screen-left eye
  eyeR: { x: 603, y: 398 },
  eyeHalfW: 42,
  eyeHalfH: 15,
  browL: { x: 405, y: 344 },
  browR: { x: 615, y: 344 },
  noseTip: { x: 514, y: 474 },
  mouth: { x: 512, y: 553 },
  mouthL: { x: 436, y: 554 },
  mouthR: { x: 590, y: 550 },
  chin: { x: 512, y: 682 },
} as const;

/** Pixels -> world units. The head is ~1.4 world units wide. */
export const PX = 1 / 300;

/** Blendshape slots. Order matters: it is the GPU weight layout. */
export const BS = {
  BlinkL: 0,
  BlinkR: 1,
  SmileL: 2,
  SmileR: 3,
  JawOpen: 4,
  BrowUp: 5,
  BrowDown: 6,
  Frown: 7,
  LookX: 8,
  LookY: 9,
  EyeWide: 10,
  BrowRaiseL: 11,
} as const;
