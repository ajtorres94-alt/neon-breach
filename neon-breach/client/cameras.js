// Security camera visuals: a wall bracket, a housing that swivels with the shared camera maths, a blinking LED and a translucent red vision cone.
import { camYaw, camDir, CAM } from '/shared/cameras.js';
import { raycast } from '/shared/physics.js';

const SIDE = [0.14, 0.15, 0.17], DARK = [0.05, 0.05, 0.06];

/** Opaque parts. alert: seconds-left of the "just spotted someone" flash (0 = idle). */
export function drawCameras(R, cams, ct, t, alert = []) {
  cams.forEach((c, i) => {
    const yaw = camYaw(c, ct), d = camDir(c, ct), hot = (alert[i] || 0) > t, blink = hot ? Math.sin(t * 22) > 0 : (t * 1.4) % 1 < 0.18;
    const inX = Math.abs(c.x) > 27 ? -Math.sign(c.x) : 0, inZ = inX ? 0 : -Math.sign(c.z);     // direction pointing away from the wall
    R.rbox(c.x - inX * 0.1, c.y, c.z - inZ * 0.1, inX ? 0.08 : 0.4, 0.4, inZ ? 0.08 : 0.4, 0, 0, SIDE, 0.015, 0, 1, 0.4);              // wall plate
    R.tube(c.x, c.y + 0.02, c.z, c.x + inX * 0.4, c.y - 0.04, c.z + inZ * 0.4, 0.05, 0.05, SIDE, 0.4);                                   // arm
    const bx = c.x + inX * 0.45, by = c.y - 0.1, bz = c.z + inZ * 0.45;
    R.sphere(bx, by + 0.04, bz, 0.09, 0.09, 0.09, SIDE, 0, 1, 0.5);                                                                     // pan joint
    R.rbox(bx + d[0] * 0.3, by + d[1] * 0.3, bz + d[2] * 0.3, 0.26, 0.24, 0.66, yaw, c.pitch, [0.22, 0.24, 0.27], 0.05, 0, 1, 0.65);   // body
    R.rbox(bx + d[0] * 0.27, by + d[1] * 0.27 + 0.13, bz + d[2] * 0.27, 0.3, 0.04, 0.5, yaw, c.pitch, [0.12, 0.13, 0.15], 0.015, 0, 1, 0.4);    // sun shield
    R.sphere(bx + d[0] * 0.66, by + d[1] * 0.66, bz + d[2] * 0.66, 0.095, 0.095, 0.095, DARK, 0, 1, 0.95);                              // lens
    R.sphere(bx + d[0] * 0.72, by + d[1] * 0.72, bz + d[2] * 0.72, 0.045, 0.045, 0.045, [0.2, 0.3, 0.5], 0.5, 1, 0.95);                 // lens glint
    const led = [bx + d[0] * 0.55, by + d[1] * 0.55 + 0.14, bz + d[2] * 0.55];
    R.sphere(led[0], led[1], led[2], 0.035, 0.035, 0.035, blink ? [1, 0.12, 0.1] : [0.25, 0.04, 0.04], blink ? 1 : 0);
  });
}

/** Translucent cones (transparent pass). Drawn until they hit scenery, so players can read where a camera can see. */
export function drawCameraCones(R, cams, ct, t, alert, boxes) {
  const tan = Math.tan(CAM.half);
  cams.forEach((c, i) => {
    const d = camDir(c, ct), hot = (alert[i] || 0) > t;
    const hit = raycast(boxes, [c.x, c.y, c.z], d, CAM.range), len = hit ? hit.t : CAM.range;
    const col = hot ? [1, 0.12, 0.08] : [1, 0.35, 0.25];
    R.tube(c.x + d[0] * 0.7, c.y - 0.1 + d[1] * 0.7, c.z + d[2] * 0.7, c.x + d[0] * len, c.y + d[1] * len, c.z + d[2] * len, 0.05, len * tan, col, 0, 1, hot ? 0.22 : 0.11);
  });
}

/** Minimap wedge for one camera, drawn in map space with the camera at the origin facing "up" after rotation. */
export function miniCamera(mctx, c, ct, ppu, hot) {
  mctx.save(); mctx.translate(c.x * ppu, c.z * ppu); mctx.rotate(-camYaw(c, ct));
  mctx.fillStyle = hot ? 'rgba(255,60,50,0.32)' : 'rgba(255,90,70,0.15)';
  mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, 17 * ppu, -Math.PI / 2 - CAM.half * 1.25, -Math.PI / 2 + CAM.half * 1.25); mctx.closePath(); mctx.fill();
  mctx.fillStyle = hot ? '#ff4a3a' : '#ff8a70'; mctx.fillRect(-3, -3, 6, 6);
  mctx.restore();
}
