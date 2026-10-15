/*
gunsLoad.js
External GLB model loading for M4A1, AWP Sniper, and MP5,
reload animations, and user-imported Blender GLB/GLTF model controls.
*/
let customGunMesh = null;
const gltfLoader = new THREE.GLTFLoader();

/* ======================================================================
WEAPON MODEL URLS & CONFIGURATIONS
====================================================================== */
const M4A1_MODEL_URL = 'models/guns/m4a1.glb';
const AWP_MODEL_URL = 'models/guns/AWP.glb';
const MP5_MODEL_URL = 'models/guns/mp5.glb';
const M4A1_MODEL_SCALE = 0.14;
const AWP_MODEL_SCALE = 1.2897;
const MP5_MODEL_SCALE = 0.14;
const M4A1_RELOAD_SPEED = 1.0;
const AWP_RELOAD_SPEED = 1.0;
const MP5_RELOAD_SPEED = 1.0;
const M4A1_IRON_AIM_Y = 0.094;
const AWP_IRON_AIM_Y = 0.109;
const MP5_IRON_AIM_Y = 0.104;
// ADS fine-tuning (X: + moves gun right, Z: more negative = further from camera)
const M4A1_ADS_X = 0, M4A1_ADS_Z = -0.25;
const AWP_ADS_X = 0.014, AWP_ADS_Z = -0.09;
const MP5_ADS_X = -0.01, MP5_ADS_Z = 0;
// ADS handling (used by game.js): 1 = unchanged, lower = slower / steadier
const ADS_MOVE_MULT = 0.5;    // movement speed multiplier while aiming down sights
const ADS_SWAY_MULT = 0.25;   // gun sway multiplier while aiming down sights
const M4A1_ORIGIN = new THREE.Vector3(-0.9, 0.22, 0);
const AWP_ORIGIN = new THREE.Vector3(0.0202, 0.0615, 0.0007);
const MP5_ORIGIN = new THREE.Vector3(-0.9, 0.22, 0);
// Parsed GLB templates and animation clips
let m4a1Template = null, m4a1Clips = [];
let AWPTemplate = null, AWPClips = [];
let mp5Template = null, mp5Clips = [];
let scopeTemplates = {};
let weaponAnim = null; // Runtime state for the currently held GLB weapon

/* ======================================================================
SCOPE / OPTIC MODELS (loaded from .glb files)
====================================================================== */
const SCOPE_MODELS = {
	reddot: { url: 'models/attachments/scopes/reddot.glb', length: 0.12, sightFrac: 0, flip: false, lift: 0, offsetZ: 0, offsetX: 0 },
	acog:   { url: 'models/attachments/scopes/4x.glb',   length: 0.24, sightFrac: 0, flip: false, lift: 0, offsetZ: 0, offsetX: 0 },
	sniper: { url: 'models/attachments/scopes/8x.glb',   length: 0.46, sightFrac: 0, flip: false, lift: 0, offsetZ: 0, offsetX: 0 }
};

function buildScopeGlb(type, railY, railCenterZ) {
	const cfg = SCOPE_MODELS[type], tpl = scopeTemplates[type];
	if (!cfg || !tpl) return null;
	const model = tpl.clone(true);
	const holder = new THREE.Group();
	holder.add(model);
	const size0 = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
	const longest = Math.max(size0.x, size0.y, size0.z) || 1;
	if (size0.x >= size0.z) holder.rotation.y = cfg.flip ? -Math.PI / 2 : Math.PI / 2;
	else holder.rotation.y = cfg.flip ? Math.PI : 0;
	holder.scale.setScalar(cfg.length / longest);
	holder.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(holder);
	const c = box.getCenter(new THREE.Vector3());
	holder.position.set(
		-c.x + (cfg.offsetX || 0),
		railY - box.min.y + cfg.lift,
		railCenterZ - c.z + cfg.offsetZ
	);
	const height = box.max.y - box.min.y;
	const aimY = railY + cfg.lift + cfg.sightFrac * height;
	holder.userData.sightLocal = new THREE.Vector3(cfg.offsetX || 0, aimY, railCenterZ + cfg.offsetZ);
	holder.userData.scopeType = type;
	return { node: holder, aimY };
}

/* ======================================================================
PER-WEAPON PART CONFIG (MP5 / AWP)
====================================================================== */
const WEAPON_PARTS = {
	mp5: {
		emptyMag: ['919_mp5_30rnd_empty_mag_2'],
		fullMag:  ['919_mp5_30rnd_mag_3'],
		sights:   [],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['919_1'],
		magOutAt: null,
		magInAt:  null
	},
	AWP: {
		emptyMag: ['762x51_mag_1'],
		fullMag:  ['762x51_mag_empty_2'],
		sights:   [],
		scope:    ['hawke_endurance__9'],
		scopeShowOn: 'sniper',
		hidden:   ['76251_0'],
		magOutAt: null,
		magInAt:  null
	}
};

function resolveParts(model, specs) {
	const out = [];
	(specs || []).forEach((spec) => {
		model.traverse((o) => {
			if (o === model) return;
			const hit = spec instanceof RegExp ? spec.test(o.name) : o.name === spec;
			if (hit && !out.includes(o)) out.push(o);
		});
	});
	return out;
}

const setVisible = (list, v) => list.forEach((o) => { o.visible = v; });

const WEAPON_ALIGN = {
	mp5: { front: -0.56, top: 0.115, dx: 0, dy: 0, dz: 0 },
	AWP: { front: -1.10, top: 0.105, dx: 0, dy: 0, dz: 0 }
};

function alignBox(root, skip) {
	const box = new THREE.Box3(), b = new THREE.Box3();
	root.updateMatrixWorld(true);
	const visit = (o) => {
		if (skip.has(o) || o.visible === false) return;
		if (o.isMesh && o.geometry) {
			if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
			b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
			box.union(b);
		}
		o.children.forEach(visit);
	};
	visit(root);
	return box;
}

function applyAlign(outer, key) {
	const A = WEAPON_ALIGN[key];
	outer.position.copy(outer.userData.alignBase).add(new THREE.Vector3(A.dx, A.dy, A.dz));
}

function animEndFor(nodes, clips) {
	const names = new Set();
	nodes.forEach((n) => n.traverse((o) => names.add(o.name)));
	let end = 0;
	clips.forEach((c) => c.tracks.forEach((tr) => {
		if (names.has(tr.name.split('.')[0]) && tr.times.length) {
			end = Math.max(end, tr.times[tr.times.length - 1]);
		}
	}));
	return end;
}

function logGlbNodes(key) {
	const t = { m4a1: [m4a1Template, m4a1Clips], AWP: [AWPTemplate, AWPClips], mp5: [mp5Template, mp5Clips] }[key];
	if (!t || !t[0]) { console.warn('Unknown weapon or model not loaded yet:', key); return; }
	const animated = new Set();
	t[1].forEach((c) => c.tracks.forEach((tr) => animated.add(tr.name.split('.')[0])));
	const lines = [];
	const walk = (o, d) => {
		const mark = animated.has(o.name) ? ' *' : '';
		lines.push('  '.repeat(d) + (o.name || '(unnamed)') + ' [' + o.type + ']' + mark);
		o.children.forEach((c) => walk(c, d + 1));
	};
	walk(t[0], 0);
	console.log(`[${key}] clips:` + t[1].map((c) => `${c.name} (${c.duration.toFixed(2)}s)`).join(', ') +
		`\n(* = animated)\n` + lines.join('\n'));
}

function setupModelMaterials(gltfScene) {
	const seen = new Set();
	gltfScene.traverse((o) => {
		if (!o.isMesh || !o.material || seen.has(o.material)) return;
		seen.add(o.material);
		if (renderer.outputEncoding !== THREE.sRGBEncoding && o.material.color) {
			o.material.color.convertLinearToSRGB();
		}
	});
	return gltfScene;
}

function loadAllWeaponModels() {
	const statusEl = document.getElementById('loader-status');
	const loadingStatusEl = document.getElementById('loading-status');
	const loadingBar = document.getElementById('loading-bar');
	const loadingScreen = document.getElementById('loading-screen');
	if (statusEl) statusEl.innerText = 'Loading tactical weapon assets...';
	let loadedCount = 0;
	const totalModels = 3 + Object.keys(SCOPE_MODELS).length;
	const checkComplete = () => {
		loadedCount++;
		const percent = Math.round((loadedCount / totalModels) * 100);
		if (loadingBar) loadingBar.style.width = `${percent}%`;
		if (loadingStatusEl) loadingStatusEl.innerText = `Loading weapon assets: ${percent}%`;
		if (loadedCount >= totalModels) {
			if (statusEl) statusEl.innerText = 'All weapon models loaded successfully.';
			if (loadingStatusEl) loadingStatusEl.innerText = 'Tactical assets loaded successfully!';
			setTimeout(() => {
				if (loadingScreen) {
					loadingScreen.style.opacity = '0';
					setTimeout(() => loadingScreen.classList.add('hidden'), 500);
				}
			}, 400);
		}
	};
	gltfLoader.load(M4A1_MODEL_URL, (gltf) => {
		setupModelMaterials(gltf.scene);
		m4a1Template = gltf.scene;
		m4a1Clips = gltf.animations || [];
		if (currentLoadout.gun === 'm4a1') rebuildWeaponMesh();
		checkComplete();
	}, undefined, (err) => {
		console.error('Failed to load M4A1:', err);
		checkComplete();
	});
	gltfLoader.load(AWP_MODEL_URL, (gltf) => {
		setupModelMaterials(gltf.scene);
		AWPTemplate = gltf.scene;
		AWPClips = gltf.animations || [];
		if (currentLoadout.gun === 'AWP') rebuildWeaponMesh();
		checkComplete();
	}, undefined, (err) => {
		console.error('Failed to load AWP:', err);
		checkComplete();
	});
	gltfLoader.load(MP5_MODEL_URL, (gltf) => {
		setupModelMaterials(gltf.scene);
		mp5Template = gltf.scene;
		mp5Clips = gltf.animations || [];
		if (currentLoadout.gun === 'mp5') rebuildWeaponMesh();
		checkComplete();
	}, undefined, (err) => {
		console.error('Failed to load MP5:', err);
		checkComplete();
	});
	Object.entries(SCOPE_MODELS).forEach(([type, cfg]) => {
		gltfLoader.load(cfg.url, (gltf) => {
			setupModelMaterials(gltf.scene);
			scopeTemplates[type] = gltf.scene;
			if ((currentLoadout.scope || 'iron') === type) rebuildWeaponMesh();
			checkComplete();
		}, undefined, (err) => {
			console.warn(`[scope] could not load ${cfg.url}; the "${type}" optic will not be drawn.`, err);
			checkComplete();
		});
	});
}
window.addEventListener('DOMContentLoaded', loadAllWeaponModels);

/* ======================================================================
WEAPON GLB BUILDERS & ANIMATION CONTROLLERS
====================================================================== */
function buildM4a1Glb(loadout) {
	const model = m4a1Template.clone(true);
	const find = (n) => model.getObjectByName(n);
	const hideGroupOf = (n) => { const o = find(n); if (o && o.parent) o.parent.visible = false; };
	hideGroupOf('Object_38');
	hideGroupOf('Object_40');
	if (loadout.scope !== 'iron') hideGroupOf('Object_26');
	if (loadout.muzzle !== 'none') hideGroupOf('Object_20');
	if (loadout.stock !== 'standard') hideGroupOf('Object_8');
	const glbMag = (loadout.mag || 'standard') === 'standard';
	const emptyMag = find('Object_32') ? find('Object_32').parent : null;
	const fullMag = find('Object_34') ? find('Object_34').parent : null;
	const mixer = new THREE.AnimationMixer(model);
	let mainAction = null;
	const actions = m4a1Clips.map((clip) => {
		const a = mixer.clipAction(clip);
		a.setLoop(THREE.LoopOnce, 1);
		a.clampWhenFinished = true;
		a.play();
		a.time = clip.duration;
		if (!mainAction || clip.duration > mainAction.getClip().duration) mainAction = a;
		return a;
	});
	mixer.update(0);
	const outer = new THREE.Group();
	outer.scale.setScalar(M4A1_MODEL_SCALE);
	outer.rotation.y = Math.PI / 2;
	model.position.copy(M4A1_ORIGIN).negate();
	outer.add(model);
	const anim = {
		mixer, actions, mainAction,
		duration: mainAction ? mainAction.getClip().duration : 0,
		emptyMags: emptyMag ? [emptyMag] : [], fullMags: fullMag ? [fullMag] : [],
		glbMag, procMag: null, magOutAt: 0.9, magInAt: 1.25,
		reloading: false, pose: 0
	};
	if (emptyMag) emptyMag.visible = false;
	if (fullMag) fullMag.visible = glbMag;
	return { node: outer, anim };
}

function buildConfiguredGlb(key, template, clips, scale, origin, loadout) {
	const cfg = WEAPON_PARTS[key];
	const model = template.clone(true);
	const emptyMags = resolveParts(model, cfg.emptyMag);
	const fullMags = resolveParts(model, cfg.fullMag);
	const sights = resolveParts(model, cfg.sights);
	const scopes = resolveParts(model, cfg.scope);
	setVisible(resolveParts(model, cfg.hidden), false);
	if (!emptyMags.length || !fullMags.length) {
		console.warn(`[${key}] mag nodes not set. Run logGlbNodes('${key}') and fill WEAPON_PARTS.${key}.emptyMag / fullMag.`);
	}
	const scopeKey = loadout.scope || 'iron';
	if (scopeKey !== 'iron') setVisible(sights, false);
	setVisible(scopes, scopeKey === cfg.scopeShowOn);
	const glbMag = (loadout.mag || 'standard') === 'standard';
	const mixer = new THREE.AnimationMixer(model);
	let mainAction = null;
	const actions = clips.map((clip) => {
		const a = mixer.clipAction(clip);
		a.setLoop(THREE.LoopOnce, 1);
		a.clampWhenFinished = true;
		a.play();
		a.time = clip.duration;
		if (!mainAction || clip.duration > mainAction.getClip().duration) mainAction = a;
		return a;
	});
	mixer.update(0);
	const outer = new THREE.Group();
	outer.scale.setScalar(scale);
	outer.rotation.y = Math.PI / 2;
	model.position.copy(origin).negate();
	outer.add(model);
	const duration = mainAction ? mainAction.getClip().duration : 0;
	const emptyEnd = animEndFor(emptyMags, clips);
	const magOutAt = cfg.magOutAt != null ? cfg.magOutAt : (emptyEnd || duration * 0.45);
	const magInAt = cfg.magInAt != null ? cfg.magInAt : magOutAt;
	console.log(`[${key}] empty mag visible until ${magOutAt.toFixed(2)}s, fresh mag from ${magInAt.toFixed(2)}s (clip ${duration.toFixed(2)}s)`);
	const anim = {
		mixer, actions, mainAction, duration,
		emptyMags, fullMags, glbMag, procMag: null,
		magOutAt, magInAt,
		hasScope: scopes.length > 0, outer,
		reloading: false, pose: 0
	};
	setVisible(emptyMags, false);
	setVisible(fullMags, glbMag);
	const A = WEAPON_ALIGN[key];
	if (A) {
		outer.position.set(0, 0, 0);
		const skip = new Set(scopes);
		const box = alignBox(outer, skip);
		if (!box.isEmpty()) {
			outer.userData.alignBase = new THREE.Vector3(
				-(box.min.x + box.max.x) / 2,
				A.top - box.max.y,
				A.front - box.min.z
			);
			applyAlign(outer, key);
			console.log(`[${key}] aligned. Starting point for the ADS iron-sight height: ~${(A.top + A.dy - 0.015).toFixed(3)} (tune with the arrow keys while aiming)`);
		}
	}
	if (cfg.scope.length) console.log(`[${key}] built-in scope nodes found: ${scopes.length}, shown: ${scopeKey === cfg.scopeShowOn}`);
	return { node: outer, anim };
}

function buildAWPGlb(loadout) {
	return buildConfiguredGlb('AWP', AWPTemplate, AWPClips, AWP_MODEL_SCALE, AWP_ORIGIN, loadout);
}

function buildMp5Glb(loadout) {
	return buildConfiguredGlb('mp5', mp5Template, mp5Clips, MP5_MODEL_SCALE, MP5_ORIGIN, loadout);
}

/* ======================================================================
M4A1 SHELL EJECTION
====================================================================== */
const SHELL_WEAPONS = {
	m4a1: { node: 'Object_38',   port: new THREE.Vector3(0.035, 0.045, -0.12), length: 0.045 },
	AWP:  { node: 'Object_4',    port: new THREE.Vector3(0.035, 0.035, -0.10),  length: 0.060 },
	mp5:  { node: 'Object_7_1',  port: new THREE.Vector3(0.035, 0.040, -0.08), length: 0.030 }
};

const SHELL_CONFIG = {
	maxShells: 40,
	lifetime: 3.0,
	gravity: 9.8,
	eject: new THREE.Vector3(2.8, 2.6, 0.6),
	spread: 0.8,
	inheritMove: 1.0,
	spin: 18,
	offset: new THREE.Vector3(0, 0, 0),
	floorY: 0.01,
	sizeMult: 1.125,
	minLength: 0.01, maxLength: 0.12,
	brass: true,
	useFixedPort: true
};

let _brassMat = null;
function shellMaterial(fallback) {
	if (!SHELL_CONFIG.brass) return fallback;
	if (!_brassMat) _brassMat = new THREE.MeshStandardMaterial({ color: 0xd9a63c, metalness: 0.85, roughness: 0.35, emissive: 0x3d2a06 });
	return _brassMat;
}

const activeShells = [];
const _shellTmp = { s: new THREE.Vector3(), q: new THREE.Quaternion(), p: new THREE.Vector3(), c: new THREE.Vector3() };
let _shellLogged = false;

function ejectShell() {
	const why = (msg) => { if (!_shellLogged) { console.warn('[shell] not spawned:', msg); _shellLogged = true; } };
	if (typeof scene === 'undefined' || typeof camera === 'undefined') return why('scene/camera not reachable');
	if (!customGunMesh) return why('no weapon mesh');
	if (!gunGroup.visible) return;
	const wcfg = SHELL_WEAPONS[currentLoadout.gun];
	if (!wcfg) return;
	let src = customGunMesh.getObjectByName(wcfg.node);
	if (!src) return why(`no node named "${wcfg.node}" on the held weapon`);
	if (!src.isMesh) { let m = null; src.traverse((o) => { if (!m && o.isMesh) m = o; }); src = m; }
	if (!src) return why('shell node has no mesh');
	src.updateWorldMatrix(true, false);
	const geo = src.geometry;
	if (!geo.boundingBox) geo.computeBoundingBox();
	const { s, q, p, c } = _shellTmp;
	src.matrixWorld.decompose(p, q, s);
	geo.boundingBox.getCenter(c);
	const size = geo.boundingBox.getSize(new THREE.Vector3()).multiply(s);
	const longest = Math.max(size.x, size.y, size.z) || 0.001;
	const norm = (longest < SHELL_CONFIG.minLength || longest > SHELL_CONFIG.maxLength)
		? wcfg.length / longest : 1;
	const ws = s.clone().multiplyScalar(norm * SHELL_CONFIG.sizeMult);
	const mesh = new THREE.Mesh(geo, shellMaterial(src.material));
	mesh.frustumCulled = false;
	mesh.scale.copy(ws);
	mesh.position.copy(c).multiply(ws).negate();
	const pivot = new THREE.Group();
	pivot.add(mesh);
	pivot.position.copy(src.localToWorld(c.clone()));
	pivot.quaternion.copy(q);
	const camQ = new THREE.Quaternion();
	camera.getWorldQuaternion(camQ);
	let usedFallback = false;
	const local = camera.worldToLocal(pivot.position.clone());
	if (SHELL_CONFIG.useFixedPort || local.length() > 1.5 || local.length() < 0.05) {
		gunGroup.updateWorldMatrix(true, false);
		pivot.position.copy(gunGroup.localToWorld(wcfg.port.clone()));
		usedFallback = true;
	}
	pivot.position.add(SHELL_CONFIG.offset.clone().applyQuaternion(camQ));
	if (!_shellLogged) {
		console.log('[shell] first spawn', {
			cameraLocalPos: local.toArray().map((n) => +n.toFixed(3)),
			lengthInWorld: +(longest * norm * SHELL_CONFIG.sizeMult).toFixed(4),
			rescaled: norm !== 1, usedFallbackPort: usedFallback
		});
		_shellLogged = true;
	}
	const yaw = new THREE.Euler().setFromQuaternion(camQ, 'YXZ').y;
	const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
	const rnd = () => Math.random() * 2 - 1;
	const vel = new THREE.Vector3(
		SHELL_CONFIG.eject.x * (1 + 0.2 * rnd()),
		SHELL_CONFIG.eject.y + rnd() * SHELL_CONFIG.spread,
		SHELL_CONFIG.eject.z + rnd() * SHELL_CONFIG.spread * 0.5
	).applyQuaternion(yawQ);
	if (SHELL_CONFIG.inheritMove && typeof velocity !== 'undefined') {
		const mv = new THREE.Vector3(-velocity.x, 0, velocity.z).applyQuaternion(yawQ);
		vel.addScaledVector(mv, SHELL_CONFIG.inheritMove);
	}
	const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
	scene.add(pivot);
	activeShells.push({
		node: pivot, vel, spinAxis,
		spin: (0.4 + Math.random() * 0.6) * SHELL_CONFIG.spin,
		age: 0, settled: false, baseScale: 1
	});
	while (activeShells.length > SHELL_CONFIG.maxShells) removeShell(0);
}

window.addEventListener('keydown', (e) => {
	const keys = ['BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Comma', 'Period'];
	if (!keys.includes(e.code)) return;
	const wk = currentLoadout.gun, A = WEAPON_ALIGN[wk];
	if (!A || !weaponAnim || !weaponAnim.outer || !weaponAnim.outer.userData.alignBase) return;
	const step = e.shiftKey ? 0.003 : 0.01;
	switch (e.code) {
		case 'BracketRight': A.dx += step; break;
		case 'BracketLeft':  A.dx -= step; break;
		case 'Quote':        A.dy += step; break;
		case 'Semicolon':    A.dy -= step; break;
		case 'Period':       A.dz += step; break;
		case 'Comma':        A.dz -= step; break;
	}
	e.preventDefault();
	applyAlign(weaponAnim.outer, wk);
	console.log(`${wk}: { front: ${A.front}, top: ${A.top}, dx: ${A.dx.toFixed(3)}, dy: ${A.dy.toFixed(3)}, dz: ${A.dz.toFixed(3)} }`);
});

window.addEventListener('keydown', (e) => {
	if (!e.code.startsWith('Numpad') || !customGunMesh) return;
	const step = e.shiftKey ? 0.005 : 0.015;
	const wk = currentLoadout.gun;
	if (!SHELL_WEAPONS[wk]) return;
	const P = SHELL_WEAPONS[wk].port;
	switch (e.code) {
		case 'Numpad6': P.x += step; break;
		case 'Numpad4': P.x -= step; break;
		case 'Numpad8': P.y += step; break;
		case 'Numpad2': P.y -= step; break;
		case 'Numpad9': P.z -= step; break;
		case 'Numpad7': P.z += step; break;
		default: return;
	}
	e.preventDefault();
	console.log(`${wk} port: new THREE.Vector3(${P.x.toFixed(4)}, ${P.y.toFixed(4)}, ${P.z.toFixed(4)})`);
	ejectShell();
});

function debugShell() {
	if (typeof scene === 'undefined' || typeof camera === 'undefined') { console.warn('[shell] scene/camera not reachable'); return; }
	const cube = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
	const pos = camera.getWorldPosition(new THREE.Vector3());
	const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
	cube.position.copy(pos).addScaledVector(dir, 1.5);
	scene.add(cube);
	setTimeout(() => scene.remove(cube), 5000);
	console.log('[shell] debug cube added; scene children:', scene.children.length);
	const before = activeShells.length;
	testShell();
	const sh = activeShells[activeShells.length - 1];
	if (activeShells.length === before || !sh) { console.warn('[shell] ejectShell() did not create a casing'); return; }
	setTimeout(() => {
		console.log('[shell] 0.25s later', {
			stillInScene: !!sh.node.parent,
			cameraLocalPos: camera.worldToLocal(sh.node.position.clone()).toArray().map((n) => +n.toFixed(3)),
			worldY: +sh.node.position.y.toFixed(3),
			active: activeShells.length
		});
	}, 250);
}

function testShell() { _shellLogged = false; ejectShell(); }

function removeShell(i) {
	const sh = activeShells[i];
	if (sh.node.parent) sh.node.parent.remove(sh.node);
	activeShells.splice(i, 1);
}

function updateShells(delta) {
	for (let i = activeShells.length - 1; i >= 0; i--) {
		const sh = activeShells[i];
		sh.age += delta;
		if (sh.age >= SHELL_CONFIG.lifetime) { removeShell(i); continue; }
		if (!sh.settled) {
			sh.vel.y -= SHELL_CONFIG.gravity * delta;
			sh.node.position.addScaledVector(sh.vel, delta);
			sh.node.rotateOnAxis(sh.spinAxis, sh.spin * delta);
			if (sh.node.position.y <= SHELL_CONFIG.floorY) {
				sh.node.position.y = SHELL_CONFIG.floorY;
				if (Math.abs(sh.vel.y) < 0.6) {
					sh.settled = true;
				} else {
					sh.vel.y *= -0.3;
					sh.vel.x *= 0.5;
					sh.vel.z *= 0.5;
					sh.spin = 0.5;
				}
			}
		}
		const left = SHELL_CONFIG.lifetime - sh.age;
		sh.node.scale.setScalar(left < 0.5 ? Math.max(0.01, left / 0.5) : 1);
	}
}

/* ======================================================================
ADS TUNE MODE & SCOPE TUNE MODE (press T to toggle)
====================================================================== */
const ADS_TUNE = {
	'awp:reddot': { y: 0.152, x: 0, z: -0.25 },
	'mp5:reddot': { y: 0.142, x: -0.01, z: 0 },
};

// SCOPE_TUNE: Hip/Resting position of the scope on the rail.
const SCOPE_TUNE = {
	'm4a1:reddot': { y: -0.018, x: 0, z: -0.046 },
	'AWP:reddot': { y: -0.004, x: -0.014, z: -0.088 },
	'mp5:reddot': { y: -0.029, x: 0.015, z: -0.287 },
	'm4a1:acog': { y: -0.0169, x: -0.006, z: -0.04 },
	'AWP:acog': { y: -0.009, x: -0.0171, z: -0.08 },
	'mp5:acog': { y: -0.0223, x: 0.0068, z: -0.24 },
	'm4a1:sniper': { y: -0.0138, x: -0.0021, z: -0.0532 },
	'mp5:sniper': { y: -0.0227, x: 0.009, z: -0.29 },
};

// SCOPE_ADS_TUNE: Position of the scope while aiming down sights.
const SCOPE_ADS_TUNE = {
	'm4a1:reddot': { x: -0.0012 , y: -0.0685, z: 0.09 },
	'AWP:reddot': { x: -0.0152, y: -0.0693, z: 0.03 },
	'mp5:reddot': { x: 0.0088, y: -0.0128, z: -0.11 },
	'm4a1:acog': { y: -0.0855, x: -0.0031, z: 0 },
	'AWP:acog': { y: -0.0861, x: -0.0171, z: -0.04 },
	'mp5:acog': { y: -0.0866, x: 0.0068, z: -0.21 },
	'm4a1:sniper': { y: -0.0526, x: -0.0026, z: 0.17 },
	'mp5:sniper': { y: -0.0505, x: 0.0076, z: 0 },
};

let adsTuneOn = false;
let _tuneStyle = null, _tuneHud = null, _savedSniperOverlay = null;
const adsTuneKey = () => `${currentLoadout.gun}:${currentLoadout.scope || 'iron'}`;

function applyAdsTune() {
	if (!customGunMesh || !customGunMesh.userData) return;
	const t = ADS_TUNE[adsTuneKey()];
	if (!t) return;
	customGunMesh.userData.adsAimY = t.y;
	customGunMesh.userData.adsX = t.x;
	customGunMesh.userData.adsZ = t.z;
}

// Blends between SCOPE_TUNE (hip) and SCOPE_ADS_TUNE (ads) based on isADS state.
let _adsBlend = 0;
const SCOPE_ADS_BLEND_SPEED = 14;

function applyScopeTune(delta = 0) {
    if (!customGunMesh) return;
    const optic = customGunMesh.getObjectByName('optic');
    if (!optic) return;
    
    const k = adsTuneKey();
    const hipPos = SCOPE_TUNE[k] || { x: 0, y: 0.055, z: 0 };
    const adsPos = SCOPE_ADS_TUNE[k] || { x: hipPos.x, y: hipPos.y, z: hipPos.z };
    
    const aiming = typeof isADS !== 'undefined' && isADS;
    const target = aiming ? 1 : 0;
    
    if (!(delta > 0) || !isFinite(_adsBlend)) _adsBlend = target; // no/invalid delta: snap instead of never reaching ADS coords
    else _adsBlend += (target - _adsBlend) * (1 - Math.exp(-SCOPE_ADS_BLEND_SPEED * delta));
    if (Math.abs(target - _adsBlend) < 0.001) _adsBlend = target;
    
    const x = hipPos.x + (adsPos.x - hipPos.x) * _adsBlend;
    const y = hipPos.y + (adsPos.y - hipPos.y) * _adsBlend;
    const z = hipPos.z + (adsPos.z - hipPos.z) * _adsBlend;
    
    optic.position.set(x, y, z);
}

let activeTuneMode = 'gun';
let _tuneManualGun = false; // true after arrow keys: stay on the gun position

function autoTuneMode() {
	const scope = currentLoadout && currentLoadout.scope;
	if (!scope || scope === 'iron') return 'gun';
	return (typeof isADS !== 'undefined' && isADS) ? 'scope_ads' : 'scope_hip';
}

// Keeps the HUD on the right table when you enter/leave ADS (only redraws when the mode changes)
function syncTuneMode() {
	if (!adsTuneOn || _tuneManualGun) return;
	const m = autoTuneMode();
	if (m !== activeTuneMode) { activeTuneMode = m; updateTuneHud(); }
}

function updateTuneHud(msg) {
	if (!_tuneHud || !customGunMesh) return;
	const ud = customGunMesh.userData || {};
	const key = adsTuneKey();
	let x, y, z;
	let title;
	if (activeTuneMode === 'scope_ads') {
		const t = SCOPE_ADS_TUNE[key] || { x: 0, y: 0.055, z: 0 };
		x = t.x; y = t.y; z = t.z;
		title = 'SCOPE ADS TUNE (Aiming Position)';
	} else if (activeTuneMode === 'scope_hip') {
		const t = SCOPE_TUNE[key] || { x: 0, y: 0.055, z: 0 };
		x = t.x; y = t.y; z = t.z;
		title = 'SCOPE HIP TUNE (Resting Position)';
	} else {
		y = ud.adsAimY ?? 0.1;
		x = ud.adsX ?? 0;
		z = ud.adsZ ?? -0.25;
		title = 'ADS TUNE (Gun Position)';
	}
	const tbl = activeTuneMode === 'scope_ads' ? 'SCOPE_ADS_TUNE' : activeTuneMode === 'scope_hip' ? 'SCOPE_TUNE' : 'ADS_TUNE';
	if (msg !== 'quiet') console.log(`[${tbl}] '${key}': { x: ${+x.toFixed(4)}, y: ${+y.toFixed(4)}, z: ${+z.toFixed(4)} },`);
	_tuneHud.innerHTML = 
		`<b>${title}</b> &nbsp;${key}<br>` +
		`X ${x.toFixed(4)} &nbsp; Y ${y.toFixed(4)} &nbsp; Z ${z.toFixed(4)}<br>` +
		`X/Y/Z update as you move the selected object.<br>` +
		`[T] to exit` + (msg ? `<br>${msg}` : '');
}

function setAdsTune(on) {
	adsTuneOn = on;
	if (on) {
		_tuneStyle = document.createElement('style');
		_tuneStyle.textContent = '#crosshair{opacity:1 !important;display:block !important;z-index:60 !important;}';
		document.head.appendChild(_tuneStyle);
		_tuneHud = document.createElement('div');
		_tuneHud.style.cssText = 'position:fixed;left:12px;top:12px;z-index:70;padding:8px 10px;background:rgba(2,6,23,.85);border:1px solid #38bdf8;color:#bae6fd;font:11px/1.5 monospace;pointer-events:none;';
		document.body.appendChild(_tuneHud);
		if (typeof ATTACHMENTS !== 'undefined' && ATTACHMENTS.scope && ATTACHMENTS.scope.sniper) {
			_savedSniperOverlay = ATTACHMENTS.scope.sniper.useSniperOverlay;
			ATTACHMENTS.scope.sniper.useSniperOverlay = false;
		}
		_tuneManualGun = false;
		try { activeTuneMode = autoTuneMode(); } catch (err) { activeTuneMode = 'gun'; }
		updateTuneHud();
		console.log('[ads tune] ON');
	} else {
		if (_tuneStyle) _tuneStyle.remove();
		if (_tuneHud) _tuneHud.remove();
		_tuneStyle = _tuneHud = null;
		if (_savedSniperOverlay !== null && typeof ATTACHMENTS !== 'undefined') {
			ATTACHMENTS.scope.sniper.useSniperOverlay = _savedSniperOverlay;
			_savedSniperOverlay = null;
		}
		console.log('[ads tune] OFF');
	}
}

window.addEventListener('keydown', (e) => {
	if (e.code === 'KeyT' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { setAdsTune(!adsTuneOn); return; }
	if (!adsTuneOn || !customGunMesh || !customGunMesh.userData) return;
	
	const gunKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'];
	const scopeKeys = ['KeyI', 'KeyK', 'KeyJ', 'KeyL', 'KeyU', 'KeyO'];
	
	// Scope adjustments: Edit ADS coords if aiming, Hip coords if not.
	if (scopeKeys.includes(e.code)) {
		e.preventDefault();
		const k = adsTuneKey();
		const aiming = typeof isADS !== 'undefined' && isADS;
		if (aiming) {
			if (!SCOPE_ADS_TUNE[k]) {
				const hip = SCOPE_TUNE[k] || { x: 0, y: 0.055, z: 0 };
				SCOPE_ADS_TUNE[k] = { x: hip.x, y: hip.y, z: hip.z };
			}
		} else {
			if (!SCOPE_TUNE[k]) {
				SCOPE_TUNE[k] = { x: 0, y: 0.055, z: 0 };
			}
		}
		const s = aiming ? SCOPE_ADS_TUNE[k] : SCOPE_TUNE[k];
		const step = e.shiftKey ? 0.0001 : 0.01;
		switch (e.code) {
			case 'KeyI': s.y += step; break;
			case 'KeyK': s.y -= step; break;
			case 'KeyJ': s.x -= step; break;
			case 'KeyL': s.x += step; break;
			case 'KeyU': s.z += step; break;
			case 'KeyO': s.z -= step; break;
		}
		_tuneManualGun = false;
		activeTuneMode = aiming ? 'scope_ads' : 'scope_hip';
		updateTuneHud();
		return;
	}
	
	// Gun adjustments (ADS position)
	if (!isADS || !gunKeys.includes(e.code)) return;
	e.preventDefault();
	_tuneManualGun = true;
	activeTuneMode = 'gun';
	const k = adsTuneKey();
	const ud = customGunMesh.userData;
	if (!ADS_TUNE[k]) ADS_TUNE[k] = { y: ud.adsAimY != null ? ud.adsAimY : 0.1, x: ud.adsX || 0, z: ud.adsZ != null ? ud.adsZ : -0.25 };
	const t = ADS_TUNE[k];
	const step = e.shiftKey ? 0.0001 : 0.005;
	switch (e.code) {
		case 'ArrowUp':    t.y -= step; break;
		case 'ArrowDown':  t.y += step; break;
		case 'ArrowRight': t.x += step; break;
		case 'ArrowLeft':  t.x -= step; break;
		case 'PageUp':     t.z += step; break;
		case 'PageDown':   t.z -= step; break;
	}
	applyAdsTune();
	updateTuneHud();
});

function playReloadAnimation() {
	const a = weaponAnim;
	if (!a || !a.actions.length) return 1400;
	a.mixer.timeScale = currentLoadout.gun === 'AWP' ? AWP_RELOAD_SPEED : (currentLoadout.gun === 'mp5' ? MP5_RELOAD_SPEED : M4A1_RELOAD_SPEED);
	a.actions.forEach((act) => { act.reset(); act.play(); });
	a.reloading = true;
	return (a.duration / a.mixer.timeScale) * 1000;
}

function updateWeaponAnim(delta) {
	applyAdsTune();
	applyScopeTune(delta);
	try { syncTuneMode(); } catch (err) {}
	updateShells(delta);
	const a = weaponAnim;
	if (!a) return;
	a.mixer.update(delta);
	const t = a.mainAction ? a.mainAction.time : 0;
	if (a.reloading && t >= a.duration - 0.001) a.reloading = false;
	const rl = a.reloading;
	const outAt = a.magOutAt != null ? a.magOutAt : 0.9;
	const inAt = a.magInAt != null ? a.magInAt : 1.25;
	a.emptyMags.forEach((m) => { m.visible = a.glbMag && rl && t < outAt; });
	a.fullMags.forEach((m) => { m.visible = a.glbMag && (!rl || t >= inAt); });
	if (a.procMag) {
		let off = 0;
		if (rl) {
			if (t < 0.625) off = -0.35 * (t / 0.625);
			else if (t < 1.25) off = -0.35;
			else if (t < 2.0) off = -0.35 * (1 - (t - 1.25) / 0.75);
		}
		a.procMag.position.y = off;
	}
	a.pose = rl ? Math.max(0, Math.min(1, t / 0.3, (a.duration - t) / 0.3)) : 0;
	
	if (typeof isADS !== 'undefined' && customGunMesh) {
		const scopeType = currentLoadout.scope || 'iron';
		const isIron = scopeType === 'iron';
		const optic = customGunMesh.getObjectByName('optic');
		const gunModel = customGunMesh.getObjectByName('model') || customGunMesh.children[0];
		
		if (isADS) {
			if (!isIron) {
				if (gunModel) gunModel.visible = false;
				if (optic) {
					optic.visible = true;
					optic.traverse((o) => {
						if (o.isMesh && o.material && !o.userData.adsTransparent) {
							o.material = o.material.clone();
							o.material.transparent = true;
							o.material.opacity = 0.1;
							o.material.depthWrite = false;
							o.userData.adsTransparent = true;
						}
					});
				}
			} else {
				if (gunModel) gunModel.visible = true;
				if (optic) optic.visible = false;
			}
		} else {
			if (gunModel) gunModel.visible = true;
			if (optic && !isIron) {
				optic.visible = true;
				optic.traverse((o) => {
					if (o.isMesh && o.material && o.userData.adsTransparent) {
						o.material.opacity = 1;
						o.material.depthWrite = true;
						o.userData.adsTransparent = false;
					}
				});
			}
		}
	}
}

/* ======================================================================
BLENDER MODEL CUSTOM IMPORT CONTROLS
====================================================================== */
const dropZone = document.getElementById('gun-dropzone');
const fileInput = document.getElementById('gun-file-input');
if (dropZone && fileInput) {
	dropZone.addEventListener('click', () => fileInput.click());
	['dragenter', 'dragover'].forEach(eventName => {
		dropZone.addEventListener(eventName, (e) => {
			e.preventDefault();
			dropZone.classList.add('drop-zone--active');
		}, false);
	});
	['dragleave', 'drop'].forEach(eventName => {
		dropZone.addEventListener(eventName, (e) => {
			e.preventDefault();
			dropZone.classList.remove('drop-zone--active');
		}, false);
	});
	dropZone.addEventListener('drop', (e) => {
		const files = e.dataTransfer.files;
		if (files.length) loadBlenderModel(files[0]);
	});
	fileInput.addEventListener('change', (e) => {
		if (e.target.files.length) loadBlenderModel(e.target.files[0]);
	});
}

function loadBlenderModel(file) {
	const statusEl = document.getElementById('loader-status');
	statusEl.innerText = `Loading Blender model "${file.name}"...`;
	const url = URL.createObjectURL(file);
	gltfLoader.load(url, (gltf) => {
		gunGroup.clear();
		customGunMesh = gltf.scene;
		customGunMesh.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true;
				child.receiveShadow = true;
				if (child.material) {
					child.material.side = THREE.DoubleSide;
				}
			}
		});
		gunGroup.add(customGunMesh);
		statusEl.innerText = `Successfully loaded "${file.name}"!`;
	}, undefined, (err) => {
		statusEl.innerText = `Error loading model: ${err.message}`;
	});
}

const gunScale = document.getElementById('gun-scale');
const gunPosX = document.getElementById('gun-posx');
const gunPosY = document.getElementById('gun-posy');
const gunPosZ = document.getElementById('gun-posz');

function updateGunTransform() {
	if (!customGunMesh) return;
	const scale = parseFloat(gunScale.value);
	customGunMesh.scale.set(scale, scale, scale);
	document.getElementById('val-gun-scale').innerText = scale.toFixed(2);
	document.getElementById('val-gun-posx').innerText = gunPosX.value;
	document.getElementById('val-gun-posy').innerText = gunPosY.value;
	document.getElementById('val-gun-posz').innerText = gunPosZ.value;
}

[gunScale, gunPosX, gunPosY, gunPosZ].forEach(input => {
	if (input) input.addEventListener('input', updateGunTransform);
});

function toggleNode(name) {
	const o = customGunMesh && customGunMesh.getObjectByName(name);
	if (!o) { console.warn('No node named', name, 'on the held weapon'); return; }
	o.visible = !o.visible;
	console.log(name, o.visible ? 'shown' : 'hidden');
}