/**
 * AGEROUS — 3D World Renderer
 *
 * Reads world state and renders the scene.
 * Never writes to world state.
 * Uses Three.js with low-poly assets.
 *
 * Fixes vs. original:
 *   - _tintNPC: reuses a single THREE.Color per mesh instead of allocating each frame
 *   - updateBuildingVisuals: polling station only greys when explicitly closed
 *   - updateBuildingVisuals: market tints green/amber based on activityLevel
 *   - NPC activity label sprites above heads (addActivityLabel / updateActivityLabels)
 *   - Church no longer greys out on startup (open:true in worldState)
 */

import * as THREE from 'three';
import { LOCATION_IDS, WEATHER, NPC_ACTIVITY } from '../simulation/worldState.js';

// ─── World layout (3D positions) ─────────────────────────────────

export const WORLD_POSITIONS = {
  [LOCATION_IDS.SCHOOL]:          new THREE.Vector3(-18, 0, -12),
  [LOCATION_IDS.MARKET]:          new THREE.Vector3( 12, 0, -14),
  [LOCATION_IDS.CHURCH]:          new THREE.Vector3(  0, 0, -22),
  [LOCATION_IDS.POLLING_STATION]: new THREE.Vector3( -8, 0,  14),
  [LOCATION_IDS.TOWN_SQUARE]:     new THREE.Vector3(  0, 0,   0),
  [LOCATION_IDS.RIVER]:           new THREE.Vector3( 22, 0,   8),
  [LOCATION_IDS.HOUSE_1]:         new THREE.Vector3(-14, 0,  10),
  [LOCATION_IDS.HOUSE_2]:         new THREE.Vector3( -6, 0,  16),
  [LOCATION_IDS.HOUSE_3]:         new THREE.Vector3(  4, 0,  14),
  [LOCATION_IDS.HOUSE_4]:         new THREE.Vector3( 14, 0,  10),
  [LOCATION_IDS.HOUSE_5]:         new THREE.Vector3( 18, 0,  16),
};

// Activity label text per activity key
const ACTIVITY_SHORT = {
  [NPC_ACTIVITY.IDLE]:         '',
  [NPC_ACTIVITY.WORKING]:      '⚒',
  [NPC_ACTIVITY.STUDYING]:     '📖',
  [NPC_ACTIVITY.SHOPPING]:     '🛒',
  [NPC_ACTIVITY.PRAYING]:      '🙏',
  [NPC_ACTIVITY.VOTING]:       '🗳',
  [NPC_ACTIVITY.EVACUATING]:   '⚠',
  [NPC_ACTIVITY.SHELTERING]:   '🏠',
  [NPC_ACTIVITY.SLEEPING]:     '💤',
  [NPC_ACTIVITY.TRAVELING]:    '→',
  [NPC_ACTIVITY.CAMPAIGNING]:  '📣',
  [NPC_ACTIVITY.STAYING_HOME]: '🏠',
};

// ─── Renderer Class ───────────────────────────────────────────────

export class WorldRenderer {
  constructor(canvas) {
    this.canvas   = canvas;
    this.scene    = null;
    this.camera   = null;
    this.renderer = null;
    this.clock    = new THREE.Clock();

    // Scene objects indexed by id
    this._buildings    = {};
    this._npcMeshes    = {};
    this._npcLabels    = {};      // activity label sprites per NPC
    this._waterMesh    = null;
    this._groundMesh   = null;
    this._rainParticles = null;
    this._rainActive   = false;
    this._floodMesh    = null;
    this._labels       = {};

    // Reusable Color for NPC tinting (avoids per-frame allocation)
    this._scratchColor = new THREE.Color();

    // Camera orbit
    this._cameraTheta  = 0.5;
    this._cameraPhi    = 1.1;
    this._cameraRadius = 55;
    this._isDragging   = false;
    this._lastMouseX   = 0;
    this._lastMouseY   = 0;
    this._mousePos     = new THREE.Vector2();

    // Raycaster for NPC hover
    this._raycaster  = new THREE.Raycaster();
    this._hoveredNPC = null;

    this._tooltipEl   = document.getElementById('npc-tooltip');
    this._tooltipName = document.getElementById('npc-tooltip-name');
    this._tooltipInfo = document.getElementById('npc-tooltip-info');
  }

  init() {
    this._initRenderer();
    this._initScene();
    this._initLights();
    this._buildGround();
    this._buildRoads();
    this._buildRiver();
    this._buildBuildings();
    this._initRain();
    this._initFloodPlane();
    this._initControls();
  }

  // ─── Renderer Setup ──────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas:    this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x1a2535);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a2535, 60, 130);

    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 300
    );
    this._updateCameraPosition();
  }

  _updateCameraPosition() {
    const x = this._cameraRadius * Math.sin(this._cameraPhi) * Math.sin(this._cameraTheta);
    const y = this._cameraRadius * Math.cos(this._cameraPhi);
    const z = this._cameraRadius * Math.sin(this._cameraPhi) * Math.cos(this._cameraTheta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  _initLights() {
    this._ambientLight = new THREE.AmbientLight(0xffeedd, 0.6);
    this.scene.add(this._ambientLight);

    this._sunLight = new THREE.DirectionalLight(0xfff5e0, 1.2);
    this._sunLight.position.set(30, 50, 20);
    this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.set(2048, 2048);
    this._sunLight.shadow.camera.near   = 1;
    this._sunLight.shadow.camera.far    = 150;
    this._sunLight.shadow.camera.left   = -50;
    this._sunLight.shadow.camera.right  =  50;
    this._sunLight.shadow.camera.top    =  50;
    this._sunLight.shadow.camera.bottom = -50;
    this.scene.add(this._sunLight);

    this._hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c59, 0.4);
    this.scene.add(this._hemiLight);
  }

  // ─── Ground ──────────────────────────────────────────────────

  _buildGround() {
    const geo = new THREE.PlaneGeometry(100, 100, 20, 20);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getY(i);
      if (Math.abs(x) > 2 || Math.abs(z) > 2) {
        pos.setZ(i, (Math.sin(x * 0.3) + Math.cos(z * 0.3)) * 0.2);
      }
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });
    this._groundMesh = new THREE.Mesh(geo, mat);
    this._groundMesh.rotation.x = -Math.PI / 2;
    this._groundMesh.receiveShadow = true;
    this.scene.add(this._groundMesh);
  }

  // ─── Roads ───────────────────────────────────────────────────

  _buildRoads() {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x4a4a5a });
    const paths = [
      { w: 60, h: 3,  x:   0, z:  0 },   // Main horizontal
      { w:  3, h: 60, x:   0, z:  0 },   // Main vertical
      { w:  3, h: 14, x: -18, z: -6 },   // To school
      { w:  3, h: 14, x:  12, z: -7 },   // To market
      { w:  3, h: 22, x:   0, z: -11 },  // To church
      { w: 10, h:  3, x:  17, z:  8 },   // Riverside road
    ];
    for (const p of paths) {
      const geo  = new THREE.PlaneGeometry(p.w, p.h);
      const mesh = new THREE.Mesh(geo, roadMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(p.x, 0.01, p.z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  // ─── River ───────────────────────────────────────────────────

  _buildRiver() {
    const geo = new THREE.PlaneGeometry(8, 30, 6, 10);
    const mat = new THREE.MeshLambertMaterial({
      color:       0x2d6a9f,
      transparent: true,
      opacity:     0.85,
    });
    this._waterMesh = new THREE.Mesh(geo, mat);
    this._waterMesh.rotation.x = -Math.PI / 2;
    this._waterMesh.position.set(24, 0.05, 0);
    this.scene.add(this._waterMesh);
  }

  // ─── Buildings ───────────────────────────────────────────────

  _buildBuildings() {
    this._addBuilding(LOCATION_IDS.SCHOOL, {
      color:     0xe8c87a,
      roofColor: 0xc0392b,
      width: 7, height: 4, depth: 5,
      label: '🏫 School',
    });
    this._addBuilding(LOCATION_IDS.MARKET, {
      color:     0xf5cba7,
      roofColor: 0x8e44ad,
      width: 8, height: 3, depth: 7,
      label:     '🛒 Market',
      hasAwning: true,
    });
    this._addBuilding(LOCATION_IDS.CHURCH, {
      color:     0xf0ebe0,
      roofColor: 0x6c3483,
      width: 5, height: 6, depth: 7,
      label:     '⛪ Church',
      hasTower:  true,
    });
    this._addBuilding(LOCATION_IDS.POLLING_STATION, {
      color:     0xa9cce3,
      roofColor: 0x1a5276,
      width: 5, height: 3, depth: 4,
      label:     '🗳 Polls',
    });

    // Houses
    const houseColors     = [0xfadfad, 0xd5e8d4, 0xdae8fc, 0xffe6cc, 0xf8cecc];
    const houseRoofColors = [0xc0392b, 0x27ae60, 0x2980b9, 0xe67e22, 0xe74c3c];
    for (let i = 1; i <= 5; i++) {
      const id = LOCATION_IDS[`HOUSE_${i}`];
      this._addBuilding(id, {
        color:     houseColors[i - 1],
        roofColor: houseRoofColors[i - 1],
        width: 3.5, height: 2.8, depth: 3.5,
        label:     `🏠 H${i}`,
        isHouse:   true,
      });
    }

    // Town square marker
    const sqGeo = new THREE.CylinderGeometry(2, 2, 0.15, 6);
    const sqMat = new THREE.MeshLambertMaterial({ color: 0x7f8c8d });
    const sq    = new THREE.Mesh(sqGeo, sqMat);
    sq.position.copy(WORLD_POSITIONS[LOCATION_IDS.TOWN_SQUARE]);
    sq.position.y = 0.08;
    this.scene.add(sq);
  }

  _addBuilding(id, opts) {
    const pos = WORLD_POSITIONS[id];
    if (!pos) return;

    const group = new THREE.Group();
    group.position.copy(pos);

    // Body
    const bodyGeo = new THREE.BoxGeometry(opts.width, opts.height, opts.depth);
    const bodyMat = new THREE.MeshLambertMaterial({ color: opts.color });
    const body    = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = opts.height / 2;
    body.castShadow    = true;
    body.receiveShadow = true;
    group.add(body);

    // Roof (pyramid)
    const roofH   = opts.isHouse ? 1.6 : 1.2;
    const roofGeo = new THREE.ConeGeometry(
      Math.max(opts.width, opts.depth) * 0.78, roofH, 4
    );
    const roofMat = new THREE.MeshLambertMaterial({ color: opts.roofColor });
    const roof    = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y  = opts.height + roofH / 2;
    roof.castShadow  = true;
    if (opts.hasTower) roof.rotation.y = Math.PI / 4;
    group.add(roof);

    // Church tower + cross
    if (opts.hasTower) {
      const tGeo  = new THREE.BoxGeometry(1.5, opts.height + 3, 1.5);
      const tMesh = new THREE.Mesh(tGeo, bodyMat);
      tMesh.position.set(0, (opts.height + 3) / 2, -opts.depth / 2 + 0.75);
      tMesh.castShadow = true;
      group.add(tMesh);

      const crossH   = new THREE.BoxGeometry(0.1, 1.2, 0.1);
      const crossW   = new THREE.BoxGeometry(0.8, 0.1, 0.1);
      const crossMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
      const ch = new THREE.Mesh(crossH, crossMat);
      const cw = new THREE.Mesh(crossW, crossMat);
      ch.position.set(0, opts.height + 5,   -opts.depth / 2 + 0.75);
      cw.position.set(0, opts.height + 5.2, -opts.depth / 2 + 0.75);
      group.add(ch); group.add(cw);
    }

    // Market awning
    if (opts.hasAwning) {
      const awGeo = new THREE.BoxGeometry(opts.width + 2, 0.15, 2);
      const awMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
      const aw    = new THREE.Mesh(awGeo, awMat);
      aw.position.set(0, opts.height - 0.5, opts.depth / 2 + 0.8);
      group.add(aw);
    }

    // Trees around houses
    if (opts.isHouse) {
      for (let i = 0; i < 2; i++) {
        const treePos = new THREE.Vector3(
          (Math.random() - 0.5) * opts.width * 2,
          0,
          (Math.random() - 0.5) * opts.depth * 2 + opts.depth
        );
        group.add(this._makeTree(treePos));
      }
    }

    this.scene.add(group);
    this._buildings[id] = { group, body, bodyMat, originalColor: opts.color };

    this._addLabel(id, opts.label, pos);
  }

  _makeTree(pos) {
    const g        = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    const trunk    = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.6;
    g.add(trunk);

    const leafGeo = new THREE.ConeGeometry(0.7, 1.4, 5);
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x27ae60 });
    const leaf    = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.y  = 1.8;
    leaf.castShadow  = true;
    g.add(leaf);

    g.position.copy(pos);
    return g;
  }

  _addLabel(id, text, pos) {
    const canvas  = document.createElement('canvas');
    canvas.width  = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(4, 4, 248, 56, 8);
    } else {
      ctx.rect(4, 4, 248, 56);
    }
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 22px Segoe UI, system-ui, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 36);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(6, 1.5, 1);
    sprite.position.set(pos.x, 9, pos.z);
    this.scene.add(sprite);
    this._labels[id] = sprite;
  }

  // ─── Rain ────────────────────────────────────────────────────

  _initRain() {
    const count     = 3000;
    const geo       = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 100;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color:          0x9bb5e0,
      size:           0.15,
      transparent:    true,
      opacity:        0.6,
      sizeAttenuation: true,
    });
    this._rainParticles         = new THREE.Points(geo, mat);
    this._rainParticles.visible = false;
    this.scene.add(this._rainParticles);
  }

  _updateRain(weather, delta) {
    const shouldRain = [WEATHER.RAIN, WEATHER.HEAVY_RAIN, WEATHER.FLOOD].includes(weather);
    this._rainParticles.visible = shouldRain;
    if (!shouldRain) return;

    const heavy     = weather === WEATHER.HEAVY_RAIN || weather === WEATHER.FLOOD;
    const positions = this._rainParticles.geometry.attributes.position;
    const speed     = heavy ? 22 : 14;
    for (let i = 0; i < positions.count; i++) {
      let y = positions.getY(i) - speed * delta;
      if (y < -1) y = 40 + Math.random() * 5;
      positions.setY(i, y);
      positions.setX(i, positions.getX(i) - delta * (heavy ? 2 : 0.5));
    }
    positions.needsUpdate             = true;
    this._rainParticles.material.opacity = heavy ? 0.75 : 0.5;
  }

  // ─── Flood Plane ─────────────────────────────────────────────

  _initFloodPlane() {
    const geo = new THREE.PlaneGeometry(110, 110, 1, 1);
    const mat = new THREE.MeshLambertMaterial({
      color:       0x2980b9,
      transparent: true,
      opacity:     0,
    });
    this._floodMesh          = new THREE.Mesh(geo, mat);
    this._floodMesh.rotation.x = -Math.PI / 2;
    this._floodMesh.position.y = 0.2;
    this.scene.add(this._floodMesh);
  }

  _updateFloodPlane(waterLevel) {
    const t = Math.min(waterLevel / 100, 1);
    this._floodMesh.material.opacity = t * 0.55;
    this._floodMesh.position.y       = 0.2 + t * 1.2;
  }

  // ─── NPC Meshes ──────────────────────────────────────────────

  /**
   * Sync NPC data after a world reset (positions reset to home).
   * Reuses existing meshes — just moves them back home.
   */
  syncNPCs(npcs) {
    for (const id in npcs) {
      const npc  = npcs[id];
      const mesh = this._npcMeshes[id];
      if (!mesh) continue;
      const homePos = WORLD_POSITIONS[npc.home] || WORLD_POSITIONS[LOCATION_IDS.TOWN_SQUARE];
      const seed    = parseInt(id.replace('npc_', ''), 10);
      mesh.position.set(
        homePos.x + Math.sin(seed * 2.4) * 2.5,
        0.6,
        homePos.z + Math.cos(seed * 1.7) * 2.5,
      );
      npc.worldPosition       = mesh.position.clone();
      npc.targetWorldPosition = mesh.position.clone();
    }
  }

  spawnNPCs(npcs) {
    const colors = [
      0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6,
      0x1abc9c, 0xe67e22, 0x34495e, 0xe91e63, 0x00bcd4,
    ];
    let colorIdx = 0;
    for (const id in npcs) {
      const npc = npcs[id];
      const geo = new THREE.CapsuleGeometry(0.22, 0.6, 3, 6);
      const mat = new THREE.MeshLambertMaterial({ color: colors[colorIdx % colors.length] });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;

      // Head
      const headGeo = new THREE.SphereGeometry(0.22, 6, 5);
      const head    = new THREE.Mesh(headGeo, mat);
      head.position.y = 0.72;
      mesh.add(head);

      // Place at home position
      const homePos = WORLD_POSITIONS[npc.home] || WORLD_POSITIONS[LOCATION_IDS.TOWN_SQUARE];
      const seed    = parseInt(id.replace('npc_', ''), 10);
      mesh.position.set(
        homePos.x + Math.sin(seed * 2.4) * 2.5,
        0.6,
        homePos.z + Math.cos(seed * 1.7) * 2.5,
      );
      npc.worldPosition       = mesh.position.clone();
      npc.targetWorldPosition = mesh.position.clone();

      mesh.userData = { npcId: id };
      this.scene.add(mesh);
      this._npcMeshes[id] = mesh;

      // Activity label sprite (initially hidden)
      this._npcLabels[id] = this._createActivityLabel('');

      colorIdx++;
    }
  }

  /** Create an activity-label sprite above an NPC. */
  _createActivityLabel(text) {
    const canvas  = document.createElement('canvas');
    canvas.width  = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.font      = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, 32, 26);

    const tex    = new THREE.CanvasTexture(canvas);
    const mat    = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 0.6, 1);
    this.scene.add(sprite);
    return { sprite, canvas, ctx };
  }

  /** Update the activity label text for all NPCs. */
  _updateActivityLabels(npcs) {
    for (const id in npcs) {
      const npc     = npcs[id];
      const mesh    = this._npcMeshes[id];
      const label   = this._npcLabels[id];
      if (!mesh || !label) continue;

      const icon = ACTIVITY_SHORT[npc.activity] ?? '';

      // Update label canvas
      const { ctx, canvas, sprite } = label;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (icon) {
        ctx.font      = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(icon, 32, 26);
      }
      sprite.material.map.needsUpdate = true;

      // Position above NPC head
      sprite.position.set(
        mesh.position.x,
        mesh.position.y + 1.4,
        mesh.position.z,
      );
      sprite.visible = !!icon;
    }
  }

  /**
   * Update NPC mesh positions — smoothly move toward target.
   */
  updateNPCPositions(npcs, delta) {
    for (const id in npcs) {
      const npc  = npcs[id];
      const mesh = this._npcMeshes[id];
      if (!mesh) continue;

      // Derive target world position from logical location
      const targetPos = WORLD_POSITIONS[npc.location] || WORLD_POSITIONS[LOCATION_IDS.TOWN_SQUARE];
      const seed      = parseInt(id.replace('npc_', ''), 10);
      const ox        = Math.sin(seed * 2.4) * 2.5;
      const oz        = Math.cos(seed * 1.7) * 2.5;
      npc.targetWorldPosition = new THREE.Vector3(targetPos.x + ox, 0.6, targetPos.z + oz);

      // Smooth lerp toward target
      mesh.position.lerp(npc.targetWorldPosition, Math.min(1, delta * 1.5));
      npc.worldPosition = mesh.position.clone();

      // Idle bob
      mesh.position.y = 0.6 + Math.sin(Date.now() * 0.003 + seed) * 0.04;

      // Rotate toward movement direction
      const dir = npc.targetWorldPosition.clone().sub(mesh.position);
      if (dir.length() > 0.1) {
        mesh.rotation.y = Math.atan2(dir.x, dir.z);
      }

      // Activity tint
      this._tintNPC(mesh, npc.activity);
    }

    // Update activity labels (cheap: only redraws changed text)
    this._updateActivityLabels(npcs);
  }

  /**
   * Tint NPC mesh emissive colour based on activity.
   * Reuses this._scratchColor to avoid per-frame allocations.
   */
  _tintNPC(mesh, activity) {
    const c = this._scratchColor;
    switch (activity) {
      case NPC_ACTIVITY.EVACUATING:
        // Pulsing yellow-orange
        { const t = (Math.sin(Date.now() * 0.01) + 1) / 2;
          c.setRGB(0.3 * t, 0.2 * t, 0); }
        break;
      case NPC_ACTIVITY.SHELTERING:
        c.setRGB(0, 0.05, 0.15);
        break;
      case NPC_ACTIVITY.VOTING:
        c.setRGB(0, 0.1, 0.25);
        break;
      case NPC_ACTIVITY.CAMPAIGNING:
        c.setRGB(0.1, 0.05, 0);
        break;
      default:
        c.setRGB(0, 0, 0);
    }
    mesh.material.emissive.copy(c);
  }

  // ─── Building State Visuals ───────────────────────────────────

  updateBuildingVisuals(state) {
    const { locations } = state;

    for (const [id, building] of Object.entries(this._buildings)) {
      const loc = locations[id];
      if (!loc) continue;

      let color;

      if (loc.flooded) {
        // Blue-grey: flooded
        color = 0x2c6fa8;

      } else if (loc.isShelter) {
        // Amber: active shelter
        color = 0xf39c12;

      } else if (!loc.accessible || !loc.open) {
        // Grey: closed or inaccessible
        // Special case: polling station starts closed (not damaged) — use a softer grey
        if (id === LOCATION_IDS.POLLING_STATION) {
          color = 0x8899aa;  // blue-grey (inactive, not damaged)
        } else {
          color = 0x7f8c8d;  // neutral grey
        }

      } else if (id === LOCATION_IDS.MARKET) {
        // Market: tint based on activityLevel
        const activity = loc.activityLevel ?? 1.0;
        if (activity >= 1.4) {
          color = 0x58d68d;  // bright green: booming (shipment)
        } else if (activity <= 0.3) {
          color = 0xe59866;  // orange: very low activity
        } else {
          color = building.originalColor;
        }

      } else if (id === LOCATION_IDS.CHURCH && state.institutions.church.serviceActive) {
        // Warm gold: service in progress
        color = 0xf7dc6f;

      } else {
        color = building.originalColor;
      }

      building.bodyMat.color.setHex(color);
    }
  }

  // ─── Sky / Atmosphere ────────────────────────────────────────

  updateAtmosphere(state) {
    const { weather, hour } = state;
    let bgColor, fogColor, ambientColor, sunColor, ambientIntensity, sunIntensity;

    switch (weather) {
      case WEATHER.CLEAR:
        bgColor = 0x87ceeb; fogColor = 0x87ceeb;
        ambientColor = 0xfff0dd; sunColor = 0xfff5e0;
        ambientIntensity = 0.7; sunIntensity = 1.3;
        break;
      case WEATHER.CLOUDY:
        bgColor = 0x8fa8b8; fogColor = 0x8fa8b8;
        ambientColor = 0xddeef0; sunColor = 0xd0e0e8;
        ambientIntensity = 0.6; sunIntensity = 0.7;
        break;
      case WEATHER.RAIN:
        bgColor = 0x4a6070; fogColor = 0x4a5a68;
        ambientColor = 0x99aabb; sunColor = 0x8899aa;
        ambientIntensity = 0.5; sunIntensity = 0.5;
        break;
      case WEATHER.HEAVY_RAIN:
        bgColor = 0x2e3e4e; fogColor = 0x2e3d4c;
        ambientColor = 0x7788aa; sunColor = 0x6677aa;
        ambientIntensity = 0.4; sunIntensity = 0.3;
        break;
      case WEATHER.FLOOD:
        bgColor = 0x1e2e3e; fogColor = 0x1e2d3c;
        ambientColor = 0x5577aa; sunColor = 0x4466aa;
        ambientIntensity = 0.3; sunIntensity = 0.2;
        break;
      default:
        bgColor = 0x87ceeb; fogColor = 0x87ceeb;
        ambientColor = 0xfff0dd; sunColor = 0xfff5e0;
        ambientIntensity = 0.7; sunIntensity = 1.3;
    }

    this.renderer.setClearColor(bgColor);
    this.scene.fog.color.setHex(fogColor);
    this._ambientLight.color.setHex(ambientColor);
    this._ambientLight.intensity = ambientIntensity;
    this._sunLight.color.setHex(sunColor);
    this._sunLight.intensity     = sunIntensity;

    // Ground colour
    if (weather === WEATHER.FLOOD) {
      this._groundMesh.material.color.setHex(0x3a6060);
    } else if (weather === WEATHER.RAIN || weather === WEATHER.HEAVY_RAIN) {
      this._groundMesh.material.color.setHex(0x3d6648);
    } else {
      this._groundMesh.material.color.setHex(0x4a7c59);
    }

    // Day / night cycle override
    if (hour >= 6 && hour < 8) {
      // Dawn
      this._sunLight.intensity = sunIntensity * 0.6;
      this.renderer.setClearColor(0xffb347);
    } else if (hour >= 20 || hour < 6) {
      // Night
      this._ambientLight.intensity = 0.15;
      this._sunLight.intensity     = 0;
      this.renderer.setClearColor(0x0a0d18);
      this.scene.fog.color.setHex(0x0a0d18);
    }
  }

  // ─── Controls ────────────────────────────────────────────────

  _initControls() {
    const canvas = this.canvas;

    canvas.addEventListener('mousedown', e => {
      this._isDragging = true;
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;
    });
    window.addEventListener('mouseup', () => { this._isDragging = false; });
    window.addEventListener('mousemove', e => {
      this._mousePos.set(
        (e.clientX / window.innerWidth)  * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      if (this._isDragging) {
        const dx = e.clientX - this._lastMouseX;
        const dy = e.clientY - this._lastMouseY;
        this._cameraTheta -= dx * 0.007;
        this._cameraPhi    = Math.max(0.3, Math.min(1.4, this._cameraPhi + dy * 0.007));
        this._lastMouseX   = e.clientX;
        this._lastMouseY   = e.clientY;
        this._updateCameraPosition();
      }
    });
    canvas.addEventListener('wheel', e => {
      this._cameraRadius = Math.max(20, Math.min(90, this._cameraRadius + e.deltaY * 0.05));
      this._updateCameraPosition();
    });

    // Touch support
    let lastTouchDist = null;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      } else {
        this._isDragging = true;
        this._lastMouseX = e.touches[0].clientX;
        this._lastMouseY = e.touches[0].clientY;
      }
    });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2 && lastTouchDist) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        this._cameraRadius = Math.max(20, Math.min(90, this._cameraRadius - (d - lastTouchDist) * 0.1));
        lastTouchDist = d;
        this._updateCameraPosition();
      } else if (this._isDragging) {
        const dx = e.touches[0].clientX - this._lastMouseX;
        const dy = e.touches[0].clientY - this._lastMouseY;
        this._cameraTheta -= dx * 0.007;
        this._cameraPhi    = Math.max(0.3, Math.min(1.4, this._cameraPhi + dy * 0.007));
        this._lastMouseX   = e.touches[0].clientX;
        this._lastMouseY   = e.touches[0].clientY;
        this._updateCameraPosition();
      }
    }, { passive: false });
    canvas.addEventListener('touchend', () => { this._isDragging = false; lastTouchDist = null; });
  }

  // ─── NPC Tooltip (raycasting) ────────────────────────────────

  checkNPCHover(npcs, mouseEvent) {
    this._raycaster.setFromCamera(this._mousePos, this.camera);
    const meshes = Object.values(this._npcMeshes);
    const hits   = this._raycaster.intersectObjects(meshes, true);

    if (hits.length > 0) {
      let mesh = hits[0].object;
      while (mesh && !mesh.userData.npcId) mesh = mesh.parent;
      if (mesh && mesh.userData.npcId) {
        const id  = mesh.userData.npcId;
        const npc = npcs[id];
        if (npc) {
          this._tooltipEl.classList.remove('hidden');
          this._tooltipName.textContent = npc.name;
          this._tooltipInfo.innerHTML   =
            `${npc.occupation} · ${npc.age}y<br>` +
            `${npc.activity.replace(/_/g, ' ')}` +
            (npc.voted ? ' · voted ✓' : '') +
            (npc.campaigning ? ' · campaigning' : '');
          this._hoveredNPC = id;
          return;
        }
      }
    }
    this._tooltipEl.classList.add('hidden');
    this._hoveredNPC = null;
  }

  positionTooltip(mx, my) {
    const tooltip = this._tooltipEl;
    if (tooltip.classList.contains('hidden')) return;
    tooltip.style.left = `${Math.min(mx + 14, window.innerWidth  - 180)}px`;
    tooltip.style.top  = `${Math.min(my - 10, window.innerHeight - 80)}px`;
  }

  // ─── Main render loop step ───────────────────────────────────

  render(state) {
    const delta = this.clock.getDelta();

    this._updateRain(state.weather, delta);
    this._updateFloodPlane(state.waterLevel);
    this.updateBuildingVisuals(state);
    this.updateAtmosphere(state);
    this.updateNPCPositions(state.npcs, delta);

    this.renderer.render(this.scene, this.camera);
  }
}
