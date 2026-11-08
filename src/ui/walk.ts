/**
 * Input for walking around on foot (camera mode 'walk').
 *
 * Keyboard: W A S D or the arrow keys to move, Shift to run, Esc to stop.
 * Mouse: drag to look around.
 * Touch: drag on the left half to walk (a virtual stick), on the right half to look.
 */
import type { Sorter } from '../scene/sorter';

const LOOK = 0.0045; // radians per pixel
const STICK = 70; // pixels for full speed

export class WalkControls {
  private keys = new Set<string>();
  private dYaw = 0;
  private dPitch = 0;
  private drag: { id: number; x: number; y: number; stick: boolean } | null = null;
  private stick = { fwd: 0, side: 0 };
  private touch2: { id: number; x: number; y: number } | null = null;

  constructor(
    private scene: Sorter,
    private canvas: HTMLCanvasElement,
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        this.scene.setControl('cam', 'auto');
        return;
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      const stick = e.pointerType === 'touch' && e.clientX < window.innerWidth / 2;
      if (this.drag && e.pointerType === 'touch') {
        // A second finger: the other job (walk with one, look with the other).
        this.touch2 = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, stick };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const d = this.drag?.id === e.pointerId ? this.drag : this.touch2?.id === e.pointerId ? { ...this.touch2, stick: !this.drag!.stick } : null;
      if (!d) return;
      if (d.stick) {
        this.stick.fwd = Math.max(-1, Math.min(1, -(e.clientY - d.y) / STICK));
        this.stick.side = Math.max(-1, Math.min(1, (e.clientX - d.x) / STICK));
      } else {
        const px = this.drag?.id === e.pointerId ? this.drag : this.touch2!;
        this.dYaw += (e.clientX - px.x) * LOOK;
        this.dPitch += (e.clientY - px.y) * LOOK;
        px.x = e.clientX;
        px.y = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (this.touch2?.id === e.pointerId) {
        if (this.drag && !this.drag.stick) this.stick = { fwd: 0, side: 0 };
        this.touch2 = null;
        return;
      }
      if (this.drag?.id !== e.pointerId) return;
      if (this.drag.stick) this.stick = { fwd: 0, side: 0 };
      this.drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  get active(): boolean {
    return this.scene.cameraMode() === 'walk';
  }

  /** Call every frame before rendering. */
  frame(): void {
    if (!this.active) {
      this.keys.clear();
      this.dYaw = this.dPitch = 0;
      return;
    }
    const k = this.keys;
    let fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + this.stick.fwd;
    let side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + this.stick.side;
    fwd = Math.max(-1, Math.min(1, fwd));
    side = Math.max(-1, Math.min(1, side));
    const run = k.has('shift') || Math.hypot(this.stick.fwd, this.stick.side) > 0.95;
    this.scene.walkInput(fwd, side, run, this.dYaw, this.dPitch);
    this.dYaw = this.dPitch = 0;
  }
}
