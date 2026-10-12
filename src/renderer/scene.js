/**
 * AGEROUS — 3D scene
 *
 * Draws the world.  It READS world state every frame and never writes to it:
 *   - the water surface sits at world.env.stage metres, over the very same
 *     terrainHeight() the simulation floods against, so what you see under water is
 *     what the simulation says is under water;
 *   - every person is placed at the (x, z) the simulation moved them to;
 *   - building signs, shelter beacons, banners and tints are functions of state.
 */

import * as THREE from 'three';
import {
  LOCATION_SPECS, ROAD_SPECS, terrainHeight, locationElevation, sampleRoad, WORLD_HALF_SIZE,
} from '../simulation/geography.js';
import { hourF } from '../simulation/world.js';
import { isRaining, weatherOf } from '../simulation/hazard.js';
import { hash01 } from '../simulation/rng.js';

const OCC_COLORS = {
  student: 0xf4d03f, teacher: 0x8e5cc4, vendor: 0xe67e22, farmer: 0x6aa84f,
  priest: 0xf2f2f2, elder: 0x95a5a6, parent: 0x1abc9c, worker: 0x3b82f6,
};
const ICONS = {
  working: '⚒', studying: '📖', shopping: '🛒', praying: '🙏', voting: '🗳', evacuating: '🏃',
  sheltering: '🏠', sleeping: '💤', campaigning: '📣', staying_home: '🏠', stranded: '🆘', traveling: '', idle: '',
};

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.shownStage = 0;
    this.places = {};         // id -> { group, body, mat, baseColor, sign, signKey, beacon }
    this.people = {};         // npc id -> view
    this.iconTex = {};
    this._rainDrops = null;

    this._lights();
    this._terrain();
    this._roads();
    this._water();
    this._places();
    this._trees();
    this._banners();
    this._rain();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── lights & sky ──────────────────────────────────────────────────────
  _lights() {
    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x4a5a3a, 0.6);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { near: 1, far: 220, left: -60, right: 60, top: 60, bottom: -60 });
    this.sun.shadow.bias = -0.0006;
    this.moon = new THREE.DirectionalLight(0x6f86c9, 0.0);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.moon);
    this.scene.fog = new THREE.Fog(0x9ec5e8, 70, 190);
    this.scene.background = new THREE.Color(0x9ec5e8);
  }

  // ── terrain ───────────────────────────────────────────────────────────
  _terrain() {
    const size = WORLD_HALF_SIZE * 2, seg = 138;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const n = hash01(`${Math.round(x * 3)}:${Math.round(z * 3)}`) * 0.06;
      if (h < 0.05) c.setHex(0x7a6a4c);             // wet river mud
      else if (h < 0.55) c.setHex(0xb9a878);        // sandy bank
      else if (h < 1.6) c.setHex(0x6f9a4a);         // lush lowland (this is the flood plain)
      else if (h < 3.2) c.setHex(0x5d8a3f);
      else c.setHex(0x7da35a);
      c.offsetHSL(0, 0, n - 0.03);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    // a darker skirt so the world edge fades into fog rather than a cliff
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), lambert(0x55703f));
    skirt.rotation.x = -Math.PI / 2; skirt.position.y = -0.8;
    this.scene.add(skirt);
  }

  _roads() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x6b6258, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const spec of Object.values(ROAD_SPECS)) {
      const pts = sampleRoad(spec.points, 1.2);
      const verts = [], idx = [];
      pts.forEach(([x, z], i) => {
        const [px, pz] = pts[Math.max(0, i - 1)], [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
        let dx = nx - px, dz = nz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const hw = spec.width / 2;
        for (const s of [-1, 1]) {
          const X = x - dz * hw * s, Z = z + dx * hw * s;
          verts.push(X, terrainHeight(X, Z) + 0.09, Z);
        }
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
      this.scene.add(m);
    }
    // town square plaza
    const sq = LOCATION_SPECS.town_square;
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.2, 28), lambert(0xb7b2a6));
    plaza.position.set(sq.x, locationElevation('town_square') + 0.1, sq.z); plaza.receiveShadow = true;
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.9, 12), lambert(0x8d8d8d));
    well.position.set(sq.x, locationElevation('town_square') + 0.6, sq.z); well.castShadow = true;
    this.scene.add(plaza, well);
  }

  // ── water ─────────────────────────────────────────────────────────────
  _water() {
    const geo = new THREE.PlaneGeometry(WORLD_HALF_SIZE * 2.2, WORLD_HALF_SIZE * 2.2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x2f7fb8, transparent: true, opacity: 0.8, roughness: 0.25, metalness: 0.1,
    }));
    this.water.position.y = 0;
    this.scene.add(this.water);
  }

  // ── places ────────────────────────────────────────────────────────────
  _places() {
    for (const [id, s] of Object.entries(LOCATION_SPECS)) {
      if (s.kind === 'river' || s.kind === 'plaza') continue;
      const group = new THREE.Group();
      const y0 = locationElevation(id);
      group.position.set(s.x, y0, s.z);
      let body = null, baseColor = 0xffffff;

      if (s.kind === 'farm') {
        for (let i = -3; i <= 3; i++) {
          const row = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 0.8), lambert(i % 2 ? 0x8bb04a : 0xc8b35a));
          row.position.set(0, 0.12, i * 1.3); group.add(row);
        }
      } else {
        const [w, h, d] = s.size;
        const colors = { school: [0xe8c87a, 0xb03a2e], market: [0xf0d9b5, 0x7d3c98], church: [0xefe9dc, 0x5b3a8c], civic: [0xa9cce3, 0x1a5276], house: [0xf6e3c4, 0xb9472d] };
        const [wall, roof] = colors[s.kind] ?? [0xdddddd, 0x884444];
        baseColor = wall;
        body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(wall));
        body.position.y = h / 2; body.castShadow = body.receiveShadow = true;
        group.add(body);
        const rh = s.kind === 'house' ? 1.7 : 1.3;
        const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, rh, 4), lambert(roof));
        r.position.y = h + rh / 2; r.rotation.y = Math.PI / 4; r.castShadow = true; group.add(r);
        if (s.kind === 'church') {
          const tower = new THREE.Mesh(new THREE.BoxGeometry(1.8, h + 3, 1.8), lambert(wall));
          tower.position.set(0, (h + 3) / 2, -d / 2 + 0.9); tower.castShadow = true; group.add(tower);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.8, 4), lambert(roof));
          cap.position.set(0, h + 3.9, -d / 2 + 0.9); cap.rotation.y = Math.PI / 4; group.add(cap);
          const cross = lambert(0xffffff);
          const cv = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), cross); cv.position.set(0, h + 5.4, -d / 2 + 0.9);
          const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.12), cross); ch.position.set(0, h + 5.6, -d / 2 + 0.9);
          group.add(cv, ch);
        }
        if (s.kind === 'market') {
          for (let i = -2; i <= 2; i++) {
            const aw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 2), lambert(i % 2 ? 0xe74c3c : 0xf5f5f5));
            aw.position.set(i * 1.6, h - 0.4, d / 2 + 1); aw.rotation.x = 0.25; group.add(aw);
            const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), lambert(0x9a6b3a));
            crate.position.set(i * 1.6, 0.35, d / 2 + 1.6); crate.castShadow = true; group.add(crate);
          }
        }
        if (s.kind === 'civic') {
          this.pollFlag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.05), lambert(0x888888));
          this.pollFlag.position.set(0.8, h + 3.2, 0);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), lambert(0xdddddd)); pole.position.set(0, h + 1.7 + 0.3, 0);
          group.add(pole, this.pollFlag);
        }
      }
      // state beacon (shelter): a soft amber column
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.6, 24, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffc14d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      beacon.position.y = 12; beacon.visible = false; group.add(beacon);

      const signH = s.kind === 'farm' ? 3.5 : (s.size?.[1] ?? 3) + (s.kind === 'church' ? 8.5 : 4.2);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
      sign.scale.set(5, 1.25, 1); sign.position.y = signH; sign.renderOrder = 10;
      group.add(sign);
      this.scene.add(group);
      this.places[id] = { group, body, mat: body?.material, baseColor, sign, signKey: '', beacon };
    }
  }

  _signTexture(title, status, color) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(12,16,26,0.82)'; g.beginPath(); g.roundRect(4, 4, 504, 120, 22); g.fill();
    g.strokeStyle = color; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#fff'; g.font = '700 44px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(title, 256, 56);
    g.fillStyle = color; g.font = '600 32px system-ui, sans-serif';
    g.fillText(status, 256, 100);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  _trees() {
    const spots = [];
    for (let i = 0; i < 900 && spots.length < 150; i++) {
      const x = (hash01('tx' + i) - 0.5) * 2 * (WORLD_HALF_SIZE - 3), z = (hash01('tz' + i) - 0.5) * 2 * (WORLD_HALF_SIZE - 3);
      const h = terrainHeight(x, z);
      if (h < 0.9) continue;
      if (Object.values(LOCATION_SPECS).some(s => s.kind !== 'river' && Math.hypot(s.x - x, s.z - z) < (s.pad ?? 4) + 5)) continue;
      if (Object.values(ROAD_SPECS).some(r => sampleRoad(r.points, 3).some(([rx, rz]) => Math.hypot(rx - x, rz - z) < 3.5))) continue;
      spots.push([x, h, z, 0.8 + hash01('ts' + i) * 0.7]);
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 1.4, 6), lambert(0x6b4a2b), spots.length);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(0.95, 2.4, 7), lambert(0x2f7d3a), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, h, z, s], i) => {
      m.compose(new THREE.Vector3(x, h + 0.7 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, h + 2.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); leaves.setMatrixAt(i, m);
    });
    trunks.castShadow = leaves.castShadow = true;
    this.scene.add(trunks, leaves);
  }

  /** Campaign banners in the square — visible only while the world is in the campaign state. */
  _banners() {
    this.banners = new THREE.Group();
    const y = locationElevation('town_square');
    [[-2.6, 0x2e86de], [2.6, 0xe67e22]].forEach(([dx, col]) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4, 6), lambert(0xdddddd)); pole.position.set(dx, y + 2, -1.5);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.05), lambert(col)); flag.position.set(dx + 0.8, y + 3.4, -1.5);
      this.banners.add(pole, flag);
    });
    this.banners.visible = false; this.scene.add(this.banners);
  }

  _rain() {
    const n = 2500, g = new THREE.BufferGeometry();
    this._rainPos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 70, y = Math.random() * 35, z = (Math.random() - 0.5) * 70;
      this._rainPos.set([x, y, z, x - 0.1, y - 0.9, z], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this._rainPos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaec6e8, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    this.scene.add(this.rain);
    this._rainCount = n;
  }

  // ── people ────────────────────────────────────────────────────────────
  _person(npc) {
    const g = new THREE.Group();
    const col = OCC_COLORS[npc.occupation] ?? 0xcccccc;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.7, 3, 8), lambert(col));
    body.position.y = 0.85; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lambert(0xe0b48c));
    head.position.y = 1.6; head.castShadow = true;
    const legs = [-1, 1].map(s => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), lambert(0x33384a)); l.position.set(s * 0.12, 0.25, 0); return l;
    });
    const scale = npc.occupation === 'student' ? 0.78 : 1;
    g.add(body, head, ...legs); g.scale.setScalar(scale);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    icon.scale.set(0.9, 0.9, 1); icon.position.y = 2.5; icon.renderOrder = 11; icon.visible = false;
    g.add(icon);
    g.userData = { npcId: npc.id, legs, icon, iconKey: '', last: { x: npc.x, z: npc.z }, phase: hash01(npc.id) * 6 };
    this.scene.add(g);
    return g;
  }

  _iconTexture(ch) {
    if (this.iconTex[ch]) return this.iconTex[ch];
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(12,16,26,0.75)'; g.beginPath(); g.arc(48, 48, 44, 0, 7); g.fill();
    g.font = '52px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, 48, 52);
    return (this.iconTex[ch] = new THREE.CanvasTexture(c));
  }

  // ── per-frame update ──────────────────────────────────────────────────
  update(world, extra = {}) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this._updateWater(world, dt);
    this._updatePlaces(world);
    this._updateDefenses(world, dt);
    this._updatePeople(world, dt, extra.selectedId);
    this._updateSky(world);
    this._updateRain(world, dt, extra.focus);
    this.banners.visible = world.institutions.election.state === 'campaign';
    if (this.pollFlag) this.pollFlag.material.color.setHex(world.institutions.election.state === 'polling' ? 0x2ecc71 : 0x777777);
  }

  /** Structures the player has built: a wall ring that rises out of the ground, sized by state. */
  _updateDefenses(world, dt) {
    this.defenseMeshes ??= {};
    for (const [id, h] of Object.entries(world.env.defenses || {})) {
      let m = this.defenseMeshes[id];
      const spec = LOCATION_SPECS[id];
      if (!m || m.userData.h !== h) {
        if (m) { this.scene.remove(m); m.geometry.dispose(); }
        const color = h <= 0.5 ? 0xc9a96b : h <= 1.0 ? 0x6f8f4e : 0xb9bec7;
        m = new THREE.Mesh(new THREE.CylinderGeometry(spec.pad + 0.5, spec.pad + 0.9, h + 0.35, 40, 1, true),
          new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }));
        m.position.set(spec.x, locationElevation(id) + (h + 0.35) / 2 - 0.15, spec.z);
        m.castShadow = true; m.receiveShadow = true; m.userData = { h, grow: 0 };
        m.scale.y = 0.01; this.scene.add(m); this.defenseMeshes[id] = m;
      }
      if (m.userData.grow < 1) { m.userData.grow = Math.min(1, m.userData.grow + dt / 1.5); m.scale.y = Math.max(0.01, m.userData.grow); m.position.y = locationElevation(id) - 0.15 + ((h + 0.35) * m.scale.y) / 2; }
    }
    for (const id of Object.keys(this.defenseMeshes)) if (!world.env.defenses?.[id]) { this.scene.remove(this.defenseMeshes[id]); delete this.defenseMeshes[id]; }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this._adaptQuality();
  }

  /** Keep it playable on modest GPUs: if the frame rate sags, drop shadow detail and pixel ratio. */
  _adaptQuality() {
    const now = performance.now();
    this._fps ??= { last: now, frames: 0, level: 0, ok: 0 };
    const f = this._fps; f.frames++;
    if (now - f.last < 2000) return;
    const fps = (f.frames * 1000) / (now - f.last); f.last = now; f.frames = 0; this.fps = Math.round(fps);
    if (fps < 28 && f.level < 2) {
      f.level++;
      if (f.level === 1) { this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25)); }
      else { this.renderer.shadowMap.enabled = false; this.renderer.setPixelRatio(1); this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
      this._resize();
    }
  }

  _updateWater(world, dt) {
    const target = world.env.stage;
    this.shownStage += (target - this.shownStage) * Math.min(1, dt * 3);
    this.water.position.y = this.shownStage + Math.sin(this.time * 1.3) * 0.03;
    this.water.material.opacity = 0.62 + Math.min(0.2, this.shownStage * 0.1);
  }

  _updatePlaces(world) {
    const civil = world.institutions.civil;
    for (const [id, p] of Object.entries(this.places)) {
      const loc = world.locations[id];
      let status = 'OPEN', color = '#59d98e';
      if (id === 'school') { if (!world.institutions.school.open) { status = 'CLOSED'; color = '#ff6b6b'; } else if (world.institutions.school.exam) status = 'EXAMS'; }
      else if (id === 'market') {
        const m = world.institutions.market;
        if (!m.open) { status = 'CLOSED'; color = '#ff6b6b'; } else status = `OPEN · price ${m.price.toFixed(2)}×`;
      } else if (id === 'church') {
        const sv = world.institutions.church.service;
        status = sv?.begun ? 'SERVICE' : 'OPEN'; if (sv?.begun) color = '#ffd166';
      } else if (id === 'polling_station') {
        const st = world.institutions.election.state;
        status = st === 'polling' ? 'POLLS OPEN' : 'CLOSED'; color = st === 'polling' ? '#59d98e' : '#9aa5b5';
      } else if (loc && loc.kind === 'house') { status = ''; }
      else if (id === 'fields') status = loc.flooded ? '' : 'FARMLAND';
      if (loc?.isShelter) { status = `SHELTER · ${Object.values(world.npcs).filter(n => n.location === id).length} inside`; color = '#ffc14d'; }
      if (loc?.flooded) { status = 'FLOODED'; color = '#6ec1ff'; }
      const key = `${loc?.name}|${status}|${color}`;
      if (key !== p.signKey) {
        p.signKey = key;
        p.sign.material.map?.dispose();
        p.sign.material.map = this._signTexture(loc.name, status, color);
        p.sign.material.needsUpdate = true;
        p.sign.scale.set(status ? 5.2 : 3.4, status ? 1.3 : 1, 1);
      }
      p.beacon.visible = !!loc?.isShelter;
      if (p.mat) {
        const tint = loc.flooded ? new THREE.Color(p.baseColor).lerp(new THREE.Color(0x4a79a8), 0.55)
          : (id === 'school' && !world.institutions.school.open) || (id === 'market' && !world.institutions.market.open)
            ? new THREE.Color(p.baseColor).lerp(new THREE.Color(0x777777), 0.5) : new THREE.Color(p.baseColor);
        p.mat.color.lerp(tint, 0.1);
      }
    }
  }

  _updatePeople(world, dt, selectedId) {
    for (const npc of Object.values(world.npcs)) {
      let v = this.people[npc.id];
      if (!v) { v = this.people[npc.id] = this._person(npc); v.position.set(npc.x, terrainHeight(npc.x, npc.z), npc.z); }
      const u = v.userData;
      // The sim ticks in whole minutes, so glide the model toward its simulated position.
      u.vx ??= npc.x; u.vz ??= npc.z;
      const gap = Math.hypot(npc.x - u.vx, npc.z - u.vz);
      if (gap > 4) { u.vx = npc.x; u.vz = npc.z; } else { const k = 1 - Math.exp(-dt * 14); u.vx += (npc.x - u.vx) * k; u.vz += (npc.z - u.vz) * k; }
      const dx = u.vx - u.last.x, dz = u.vz - u.last.z;
      const moving = gap > 0.03;
      u.last.x = u.vx; u.last.z = u.vz;
      const y = terrainHeight(u.vx, u.vz);
      v.position.set(u.vx, y, u.vz);
      if (moving) { v.rotation.y = Math.atan2(dx, dz); u.phase += dt * 11; } else u.phase += dt * 0.3;
      const swing = moving ? Math.sin(u.phase) * 0.45 : 0;
      u.legs[0].rotation.x = swing; u.legs[1].rotation.x = -swing;
      v.children[0].position.y = 0.85 + (moving ? Math.abs(Math.sin(u.phase)) * 0.05 : 0);
      // sleeping people lie down
      v.rotation.x = npc.activity === 'sleeping' && npc.location ? -1.2 : 0;
      const ic = npc.id === selectedId ? '⭐' : (ICONS[npc.activity] ?? '');
      if (ic !== u.iconKey) {
        u.iconKey = ic;
        if (ic) { u.icon.material.map = this._iconTexture(ic); u.icon.material.needsUpdate = true; }
        u.icon.visible = !!ic;
      }
    }
  }

  _updateSky(world) {
    const h = hourF(world);
    const sunA = ((h - 6) / 12) * Math.PI;                      // 06:00 east horizon → 18:00 west horizon
    const day = Math.max(0, Math.sin(sunA));
    const w = weatherOf(world);
    const gloom = w === 'storm' ? 0.55 : w === 'rain' ? 0.35 : w === 'drizzle' ? 0.2 : w === 'cloudy' ? 0.15 : 0;
    const dusk = Math.max(0, 1 - Math.abs(day - 0.12) * 5) * (day < 0.3 ? 1 : 0);
    this.sun.position.set(Math.cos(sunA) * -60, Math.max(8, Math.sin(sunA) * 70), 30);
    this.sun.intensity = 1.5 * day * (1 - gloom * 0.8);
    this.sun.color.setHex(0xfff1d6).lerp(new THREE.Color(0xff9a52), dusk);
    this.moon.position.set(30, 60, -20); this.moon.intensity = 0.35 * (1 - day);
    this.hemi.intensity = (0.12 + 0.55 * day) * (1 - gloom * 0.4);
    const sky = new THREE.Color(0x070b18).lerp(new THREE.Color(0x9ec5e8), day);
    sky.lerp(new THREE.Color(0xf0a070), dusk * 0.55);
    sky.lerp(new THREE.Color(0x56606c), gloom * (0.3 + 0.7 * day));
    this.scene.background.copy(sky); this.scene.fog.color.copy(sky);
    this.scene.fog.near = 60 - gloom * 30; this.scene.fog.far = 190 - gloom * 90;
    this.sun.target.position.set(0, 0, 0);
  }

  _updateRain(world, dt, focus) {
    const on = isRaining(world);
    this.rain.visible = on;
    if (!on) return;
    const heavy = world.env.peak >= 1.5;
    const count = heavy ? this._rainCount : Math.floor(this._rainCount * 0.45);
    this.rain.geometry.setDrawRange(0, count * 2);
    const p = this._rainPos, speed = heavy ? 34 : 22;
    for (let i = 0; i < count; i++) {
      let y = p[i * 6 + 1] - speed * dt;
      if (y < 0) y += 35;
      p[i * 6 + 1] = y; p[i * 6 + 4] = y - 0.9;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    if (focus) this.rain.position.set(focus.x, 0, focus.z);
  }

  /** Terrain/people raycast helper for picking NPCs. */
  pickPerson(ndc) {
    const rc = this._rc ??= new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hits = rc.intersectObjects(Object.values(this.people), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.npcId) o = o.parent; if (o) return o.userData.npcId; }
    return null;
  }
}
