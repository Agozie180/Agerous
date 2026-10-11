/**
 * AGEROUS — Player avatar & cameras
 *
 * Walk mode: third-person, WASD/arrows to move, Shift to run, drag to look.
 * Sky mode (Tab): orbit the whole valley.  The player is a visitor in the world:
 * wading through floodwater slows them, and buildings are solid.
 */
import * as THREE from 'three';
import { LOCATION_SPECS, terrainHeight, WORLD_HALF_SIZE } from '../simulation/geography.js';

export class Player {
  constructor(gameScene) {
    this.gs = gameScene;
    this.x = 4; this.z = 6; this.heading = Math.PI;
    this.mode = 'walk';                  // 'walk' | 'sky'
    this.yaw = Math.PI; this.pitch = 0.42; this.dist = 9;
    this.skyYaw = 0.6; this.skyPitch = 0.95; this.skyDist = 80;
    this.keys = new Set();
    this.typing = false;                 // true while the prompt box has focus
    this.group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x35e0ff, emissive: 0x0a4a5a });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 3, 8), mat); body.position.y = 0.9; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffe0bd })); head.position.y = 1.72;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 28), new THREE.MeshBasicMaterial({ color: 0x35e0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    this.legs = [-1, 1].map(s => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), new THREE.MeshLambertMaterial({ color: 0x1b2535 })); l.position.set(s * 0.13, 0.28, 0); return l; });
    this.group.add(body, head, ring, ...this.legs);
    gameScene.scene.add(this.group);
    this.phase = 0; this.drag = null; this._bind();
  }

  _bind() {
    const c = this.gs.canvas;
    window.addEventListener('keydown', e => { if (!this.typing && !e.metaKey && !e.ctrlKey) this.keys.add(e.code); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    c.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, moved: 0 }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointerup', e => { this.dragEnded = this.drag; this.drag = null; });
    c.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.mode === 'walk') { this.yaw -= dx * 0.006; this.pitch = Math.min(1.2, Math.max(0.05, this.pitch + dy * 0.004)); }
      else { this.skyYaw -= dx * 0.006; this.skyPitch = Math.min(1.45, Math.max(0.25, this.skyPitch + dy * 0.004)); }
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.mode === 'walk') this.dist = Math.min(22, Math.max(4, this.dist + e.deltaY * 0.01));
      else this.skyDist = Math.min(140, Math.max(25, this.skyDist + e.deltaY * 0.05));
    }, { passive: false });
  }

  toggleMode() { this.mode = this.mode === 'walk' ? 'sky' : 'walk'; return this.mode; }

  /** Was the last pointer gesture a click (not a camera drag)? */
  consumeClick() { const d = this.dragEnded; this.dragEnded = null; return !!d && d.moved < 6; }

  update(world, dt) {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (this.mode === 'walk' && !this.typing) {
      if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    }
    const moving = mx || mz;
    if (moving) {
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = mx * cos + mz * sin, wz = -mx * sin + mz * cos;      // camera-relative
      const depth = Math.max(0, world.env.stage - terrainHeight(this.x, this.z));
      let speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 11 : 6.2) * (depth > 0.15 ? Math.max(0.3, 1 - depth * 0.5) : 1);
      let nx = this.x + wx * speed * dt, nz = this.z + wz * speed * dt;
      // buildings are solid
      for (const s of Object.values(LOCATION_SPECS)) {
        if (!s.size) continue;
        const hw = s.size[0] / 2 + 0.5, hd = s.size[2] / 2 + 0.5;
        if (Math.abs(nx - s.x) < hw && Math.abs(nz - s.z) < hd) {
          // slide along the face we hit
          if (Math.abs(this.x - s.x) >= hw) nx = this.x; else nz = this.z;
        }
      }
      const lim = WORLD_HALF_SIZE - 2;
      // too deep to wade
      if (world.env.stage - terrainHeight(nx, nz) > 1.3 || terrainHeight(nx, nz) < -0.45) { nx = this.x; nz = this.z; }
      this.x = Math.max(-lim, Math.min(lim, nx)); this.z = Math.max(-lim, Math.min(lim, nz));
      this.heading = Math.atan2(wx, wz);
      this.phase += dt * (k.has('ShiftLeft') ? 14 : 10);
    }
    const sw = moving ? Math.sin(this.phase) * 0.5 : 0;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    const y = terrainHeight(this.x, this.z);
    this.group.position.set(this.x, y, this.z);
    this.group.rotation.y = this.heading;
    this.group.visible = true;

    const cam = this.gs.camera;
    if (this.mode === 'walk') {
      const cy = y + 1.6;
      const px = this.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist;
      const pz = this.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist;
      const py = cy + Math.sin(this.pitch) * this.dist;
      cam.position.lerp(new (cam.position.constructor)(px, Math.max(py, terrainHeight(px, pz) + 0.8), pz), Math.min(1, dt * 10));
      cam.lookAt(this.x, cy, this.z);
    } else {
      const d = this.skyDist;
      cam.position.set(Math.sin(this.skyYaw) * Math.cos(this.skyPitch) * d, Math.sin(this.skyPitch) * d, Math.cos(this.skyYaw) * Math.cos(this.skyPitch) * d + 0);
      cam.position.x += 5; cam.lookAt(5, 0, 0);
    }
  }

  get focus() { return this.mode === 'walk' ? { x: this.x, z: this.z } : { x: 5, z: 0 }; }

  nearestNPC(world, maxDist = 4.5) {
    let best = null, bd = maxDist;
    for (const n of Object.values(world.npcs)) {
      const d = Math.hypot(n.x - this.x, n.z - this.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
}
