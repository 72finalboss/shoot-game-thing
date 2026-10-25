/*
gunsLoad.js
External GLB model loading for M4A1, AWP, MP5, SVD Dragunov, TOZ-34, Benelli M4, G17 Gen 5 MOS, M249 SAW, and IMI Uzi,
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
const SVD_MODEL_URL = 'models/guns/svd.glb';
const TOZ34_MODEL_URL = 'models/guns/toz34.glb';
const BENELLIM4_MODEL_URL = 'models/guns/benellim4.glb';
const G17_MODEL_URL = 'models/guns/g17.glb';
const M249_MODEL_URL = 'models/guns/m249.glb';
const UZI_MODEL_URL = 'models/guns/uzi.glb';
const BAYONET_MODEL_URL = 'models/melee/m9_bayonet.glb';

const M4A1_MODEL_SCALE = 0.14;
const AWP_MODEL_SCALE = 1.2897;
const MP5_MODEL_SCALE = 0.14;
const SVD_MODEL_SCALE = 0.024;
const TOZ34_MODEL_SCALE = 0.062;
const BENELLIM4_MODEL_SCALE = 0.11;
const G17_MODEL_SCALE = 0.15;
const M249_MODEL_SCALE = 1.2; // current m249.glb is in metres (~0.86 long); the old one was ~100x bigger. Tune to taste
const UZI_MODEL_SCALE = 0.78;

const M4A1_RELOAD_SPEED = 1.0;
const AWP_RELOAD_SPEED = 1.0;
const MP5_RELOAD_SPEED = 1.0;

const M4A1_IRON_AIM_Y = 0.094;
const AWP_IRON_AIM_Y = 0.109;
const MP5_IRON_AIM_Y = 0.104;
const SVD_IRON_AIM_Y = 0.102;
const TOZ34_IRON_AIM_Y = 0.092;
const BENELLIM4_IRON_AIM_Y = 0.096;
const G17_IRON_AIM_Y = 0.082;
const M249_IRON_AIM_Y = 0.108;
const UZI_IRON_AIM_Y = 0.092;

// ADS fine-tuning (X: + moves gun right, Z: more negative = further from camera)
const M4A1_ADS_X = 0, M4A1_ADS_Z = -0.25;
const AWP_ADS_X = 0.014, AWP_ADS_Z = -0.09;
const MP5_ADS_X = -0.01, MP5_ADS_Z = 0;
const SVD_ADS_X = 0, SVD_ADS_Z = -0.22;
const TOZ34_ADS_X = 0, TOZ34_ADS_Z = -0.22;
const BENELLIM4_ADS_X = 0, BENELLIM4_ADS_Z = -0.22;
const G17_ADS_X = 0, G17_ADS_Z = -0.18;
const M249_ADS_X = 0, M249_ADS_Z = -0.24;
const UZI_ADS_X = 0, UZI_ADS_Z = -0.20;

const ADS_MOVE_MULT = 0.5;
const ADS_SWAY_MULT = 0.25;

const M4A1_ORIGIN = new THREE.Vector3(-0.9, 0.22, 0);
const AWP_ORIGIN = new THREE.Vector3(0.0202, 0.0615, 0.0007);
const MP5_ORIGIN = new THREE.Vector3(-0.9, 0.22, 0);
const ZERO_ORIGIN = new THREE.Vector3(0, 0, 0);

// Parsed GLB templates and animation clips
let m4a1Template = null, m4a1Clips = [];
let AWPTemplate = null, AWPClips = [];
let mp5Template = null, mp5Clips = [];
let svdTemplate = null, svdClips = [];
let toz34Template = null, toz34Clips = [];
let benellim4Template = null, benellim4Clips = [];
let g17Template = null, g17Clips = [];
let m249Template = null, m249Clips = [];
let uziTemplate = null, uziClips = [];
let bayonetTemplate = null;
let scopeTemplates = {};
let weaponAnim = null;

function hasGlbTemplate(gunType) {
	return !!(
		(gunType === 'm4a1' && m4a1Template) ||
		(gunType === 'AWP' && AWPTemplate) ||
		(gunType === 'mp5' && mp5Template) ||
		(gunType === 'svd' && svdTemplate) ||
		(gunType === 'toz34' && toz34Template) ||
		(gunType === 'benellim4' && benellim4Template) ||
		(gunType === 'g17' && g17Template) ||
		(gunType === 'm249' && m249Template) ||
		(gunType === 'uzi' && uziTemplate)
	);
}

/* ======================================================================
SCOPE / OPTIC MODELS (loaded from .glb files)
====================================================================== */
const SCOPE_MODELS = {
	reddot: { url: 'models/attachments/scopes/reddot.glb', length: 0.12, sightFrac: 0, flip: false, lift: 0, offsetZ: 0, offsetX: 0 },
	acog:   { url: 'models/attachments/scopes/4x.glb',   length: 0.24, sightFrac: 0, flip: false, lift: 0, offsetZ: 0, offsetX: 0 },
	sniper: { url: 'models/attachments/scopes/8x.glb',   length: 0.46, sightFrac: 0, flip: false, lift: 0, offsetZ: 0, offsetX: 0 }
};

/* ======================================================================
UNDERBARREL GRIP MODELS (loaded from .glb files)
height = real-world grip length in metres. The grip is scaled to that height, hung from the rail
(top of the model on the rail) and centred on the mounting plate (top 18% of the model).
flip: true turns the grip around if its lean points the wrong way.
====================================================================== */
const GRIP_MODELS = {
	vertical: { url: 'models/attachments/grips/vertical_grip.glb', height: 0.14,  flip: false, sink: 0.004 },
	stubby:   { url: 'models/attachments/grips/stubby_grip.glb',   height: 0.075, flip: false, sink: 0.004 },
	skeleton: { url: 'models/attachments/grips/skeleton_grip.glb', height: 0.13,  flip: false, sink: 0.004 },
	folding:  { url: 'models/attachments/grips/folding_grip.glb',  height: 0.14,  flip: false, sink: 0.004 }
};
let gripTemplates = {};
const _gripFit = {};

function _fitGrip(type) {
	const cfg = GRIP_MODELS[type], holder = new THREE.Group();
	holder.add(gripTemplates[type].clone(true));
	if (cfg.flip) holder.rotation.y = Math.PI;
	holder.updateMatrixWorld(true);
	const b0 = new THREE.Box3().setFromObject(holder);
	holder.scale.setScalar(cfg.height / ((b0.max.y - b0.min.y) || 1));
	holder.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(holder);
	const yCut = box.max.y - 0.18 * (box.max.y - box.min.y);
	const slab = new THREE.Box3(), v = new THREE.Vector3();
	holder.traverse((o) => {
		if (!o.isMesh || !o.geometry.attributes.position) return;
		const p = o.geometry.attributes.position;
		for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y >= yCut) slab.expandByPoint(v); }
	});
	const c = slab.isEmpty() ? box.getCenter(new THREE.Vector3()) : slab.getCenter(new THREE.Vector3());
	return (_gripFit[type] = { scale: holder.scale.x, cx: c.x, cz: c.z, top: box.max.y });
}

function buildGripGlb(type, handleY, handleZ) {
	const cfg = GRIP_MODELS[type];
	if (!cfg || !gripTemplates[type]) return null;
	const fit = _gripFit[type] || _fitGrip(type);
	const holder = new THREE.Group();
	holder.add(gripTemplates[type].clone(true));
	if (cfg.flip) holder.rotation.y = Math.PI;
	holder.scale.setScalar(fit.scale);
	holder.position.set(-fit.cx, handleY + (cfg.sink || 0) - fit.top, handleZ - fit.cz);
	holder.name = 'grip';
	return holder;
}

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
PER-WEAPON PART CONFIG
====================================================================== */
const WEAPON_PARTS = {
	mp5: {
		emptyMag: ['919_mp5_30rnd_empty_mag_2'],
		fullMag:  ['919_mp5_30rnd_mag_3'],
		bolt:     [],
		sights:   [],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['919_1'],
		gripParts: ['Object_40'],   // the model's own stubby grip: hidden unless the stubby grip is selected
		gripShowOn: 'stubby',
		magOutAt: null,
		magInAt:  null
	},
	AWP: {
		emptyMag: ['762x51_mag_1'],
		fullMag:  ['762x51_mag_empty_2'],
		bolt:     [],
		sights:   [],
		scope:    ['hawke_endurance__9'],
		scopeShowOn: 'sniper',
		hidden:   ['76251_0'],
		magOutAt: null,
		magInAt:  null
	},
	svd: {
		emptyMag: [],
		fullMag:  ['mag_anim'],
		bolt:     ['bolt_anim'],
		sights:   [],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['shell_anim'],
		magOutAt: 0.75,
		magInAt:  1.15,
		procDuration: 2.0
	},
	toz34: {
		emptyMag: [],
		fullMag:  [],
		bolt:     ['toz34 lock lever_6'],
		barrels:  ['toz34 barrels_2'],
		sights:   [],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['1276_0', '12/76_1'],
		magOutAt: 0.7,
		magInAt:  1.2,
		procDuration: 2.1
	},
	benellim4: {
		emptyMag: [],
		fullMag:  [],
		bolt:     ['m1014 bolt_5'],
		sights:   [],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['1270n1_1', '1270n1 case_2'],
		magOutAt: 0.7,
		magInAt:  1.2,
		procDuration: 2.0
	},
	g17: {
		emptyMag: [],
		fullMag:  ['g17 17rnd empty mag_4'],
		bolt:     ['g17g5mos slide_0'],
		sights:   ['g17g5mos cover_8'],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['g17 17rnd mag_2', '919_5', '919 case_6'],
		magOutAt: 0.55,
		magInAt:  0.90,
		procDuration: 1.5
	},
	m249: {
		emptyMag: [],
		fullMag:  ['mag_anim'],
		bolt:     ['bolt_anim'],
		sights:   [],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['shell_anim'],
		magOutAt: 1.0,
		magInAt:  1.6,
		procDuration: 2.6
	},
	uzi: {
		emptyMag: [],
		fullMag:  ['mag_anim'],
		bolt:     ['bolt_anim'],
		sights:   [],
		scope:    [],
		scopeShowOn: 'sniper',
		hidden:   ['shell_anim'],
		magOutAt: 0.6,
		magInAt:  0.95,
		procDuration: 1.6
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
	mp5:       { front: -0.56, top: 0.115, dx: 0, dy: 0, dz: 0 },
	AWP:       { front: -1.10, top: 0.105, dx: 0, dy: 0, dz: 0 },
	svd:       { front: -1.05, top: 0.105, dx: 0, dy: 0, dz: 0 },
	toz34:     { front: -0.95, top: 0.095, dx: 0, dy: 0, dz: 0 },
	benellim4: { front: -0.88, top: 0.100, dx: 0, dy: 0, dz: 0 },
	g17:       { front: -0.32, top: 0.085, dx: 0, dy: 0, dz: 0 },
	m249:      { front: -0.88, top: 0.115, dx: 0, dy: 0, dz: 0 },
	uzi:       { front: -0.42, top: 0.095, dx: 0, dy: 0, dz: 0 }
};

function alignBox(root, skip) {
	const box = new THREE.Box3(), b = new THREE.Box3();
	root.updateMatrixWorld(true);
	const visit = (o) => {
		if (skip.has(o) || o.visible === false) return;
		if (o.isMesh && o.geometry && !o.isSkinnedMesh) { // live skinned meshes: their rest-pose bounds are not where they are drawn
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

/* Converts SkinnedMesh models (SVD, M249, Uzi) into clean static Mesh groups split by bone role */
function extractSkinnedWeapon(gltfScene) {
	const root = new THREE.Group();
	const bodyGroup = new THREE.Group(); bodyGroup.name = 'body_anim';
	const magGroup = new THREE.Group(); magGroup.name = 'mag_anim';
	const boltGroup = new THREE.Group(); boltGroup.name = 'bolt_anim';
	const shellGroup = new THREE.Group(); shellGroup.name = 'shell_anim';
	shellGroup.visible = false;
	root.add(bodyGroup, magGroup, boltGroup, shellGroup);

	const skinnedMeshes = [];
	gltfScene.traverse((o) => {
		if (o.isSkinnedMesh && o.geometry && o.skeleton) skinnedMeshes.push(o);
	});

	skinnedMeshes.forEach((sm) => {
		const geo = sm.geometry;
		const jointsAttr = geo.attributes.JOINTS_0;
		const bones = sm.skeleton.bones;
		if (!jointsAttr || !bones || !bones.length) {
			bodyGroup.add(new THREE.Mesh(geo, sm.material));
			return;
		}
		const indexAttr = geo.index;
		const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(geo.attributes.position.count / 3);
		const buckets = { body: [], mag: [], bolt: [], shell: [] };

		for (let t = 0; t < triCount; t++) {
			const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
			const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
			const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
			const bIdx = jointsAttr.getX(i0);
			const bName = (bones[bIdx] && bones[bIdx].name ? bones[bIdx].name : '').toLowerCase();
			if (bName.startsWith('mag_') || bName.startsWith('bullets')) {
				buckets.mag.push(i0, i1, i2);
			} else if (bName.startsWith('bullet_')) {
				buckets.mag.push(i0, i1, i2);
				buckets.shell.push(i0, i1, i2);
			} else if (bName.startsWith('bolt') || bName.startsWith('charginghandle')) {
				buckets.bolt.push(i0, i1, i2);
			} else {
				buckets.body.push(i0, i1, i2);
			}
		}

		const addBucketMesh = (indices, targetGroup, meshName) => {
			if (!indices.length) return;
			const subGeo = new THREE.BufferGeometry();
			subGeo.setAttribute('position', geo.attributes.position);
			if (geo.attributes.normal) subGeo.setAttribute('normal', geo.attributes.normal);
			if (geo.attributes.uv) subGeo.setAttribute('uv', geo.attributes.uv);
			subGeo.setIndex(indices);
			subGeo.computeBoundingBox();
			subGeo.computeBoundingSphere();
			const m = new THREE.Mesh(subGeo, sm.material);
			if (meshName) m.name = meshName;
			targetGroup.add(m);
		};

		addBucketMesh(buckets.body, bodyGroup);
		addBucketMesh(buckets.mag, magGroup);
		addBucketMesh(buckets.bolt, boltGroup);
		addBucketMesh(buckets.shell, shellGroup, 'shell_mesh');
	});

	return root;
}

/* Prepares a GLB whose skinned parts (ammo box + belt) must be played live with the clips authored in the GLB.
   - drops stray helper meshes far away from the weapon
   - three.js applies a skinned mesh node's own transform, glTF (and Blender) ignore it. Move the skinned meshes to the scene root
     with an identity transform + identity bind so they render exactly where the skeleton puts them, like in Blender.
   - rotateY turns the model so its muzzle points where buildConfiguredGlb expects it */
function prepareLiveSkinnedWeapon(gltfScene, rotateY = 0) {
	gltfScene.updateMatrixWorld(true);
	const statics = [], skinned = [];
	gltfScene.traverse((o) => {
		if (o.isSkinnedMesh) { skinned.push(o); return; }
		if (!o.isMesh || !o.geometry) return;
		o.geometry.computeBoundingBox();
		const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
		statics.push({ o, centre: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()).length() });
	});
	if (statics.length) {
		const main = statics.reduce((a, b) => (b.size > a.size ? b : a));
		statics.forEach((e) => { if (e.centre.distanceTo(main.centre) > main.size * 3 && e.o.parent) e.o.parent.remove(e.o); });
	}
	skinned.forEach((sm) => {
		gltfScene.add(sm); // re-parents
		sm.position.set(0, 0, 0); sm.quaternion.identity(); sm.scale.set(1, 1, 1);
		sm.updateMatrixWorld(true);
		sm.bind(sm.skeleton, new THREE.Matrix4());
		sm.frustumCulled = false;
	});
	const pivot = new THREE.Group();
	pivot.rotation.y = rotateY;
	pivot.add(gltfScene);
	return pivot;
}

/* Object3D.clone() leaves cloned SkinnedMeshes bound to the ORIGINAL bones, so the clone's animation would not deform them: rebind by bone name */
function cloneWeaponModel(template) {
	const model = template.clone(true);
	const bones = {};
	model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
	model.traverse((o) => {
		if (!o.isSkinnedMesh || !o.skeleton) return;
		o.bind(new THREE.Skeleton(o.skeleton.bones.map((b) => bones[b.name] || b), o.skeleton.boneInverses), o.bindMatrix);
		o.frustumCulled = false;
	});
	return model;
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

	const weaponLoadList = [
		{ key: 'm4a1', url: M4A1_MODEL_URL, skinned: false, assign: (s, c) => { m4a1Template = s; m4a1Clips = c; } },
		{ key: 'AWP', url: AWP_MODEL_URL, skinned: false, assign: (s, c) => { AWPTemplate = s; AWPClips = c; } },
		{ key: 'mp5', url: MP5_MODEL_URL, skinned: false, assign: (s, c) => { mp5Template = s; mp5Clips = c; } },
		{ key: 'svd', url: SVD_MODEL_URL, skinned: true, assign: (s, c) => { svdTemplate = s; svdClips = c; } },
		{ key: 'toz34', url: TOZ34_MODEL_URL, skinned: false, assign: (s, c) => { toz34Template = s; toz34Clips = c; } },
		{ key: 'benellim4', url: BENELLIM4_MODEL_URL, skinned: false, assign: (s, c) => { benellim4Template = s; benellim4Clips = c; } },
		{ key: 'g17', url: G17_MODEL_URL, skinned: false, assign: (s, c) => { g17Template = s; g17Clips = c; } },
		{ key: 'm249', url: M249_MODEL_URL, skinned: false, prepare: (scene) => prepareLiveSkinnedWeapon(scene, Math.PI / 2), assign: (s, c) => { m249Template = s; m249Clips = c; } },
		{ key: 'uzi', url: UZI_MODEL_URL, skinned: true, assign: (s, c) => { uziTemplate = s; uziClips = c; } },
		{ key: 'bayonet', url: BAYONET_MODEL_URL, skinned: false, assign: (s) => {
			// no environment map in the scene, so a fully metallic material renders almost black: soften it
			s.traverse((o) => {
				if (!o.isMesh || !o.material || o.material.userData.meleeTuned) return;
				o.material.userData.meleeTuned = true;
				if (o.material.metalness > 0.6) o.material.metalness = 0.55;
				if (o.material.color && o.material.color.r > 0.9 && o.material.color.g > 0.9) o.material.color.setHex(0xaab2bd);
			});
			bayonetTemplate = s;
		} }
	];

	let loadedCount = 0;
	const totalModels = weaponLoadList.length + Object.keys(SCOPE_MODELS).length + Object.keys(GRIP_MODELS).length;
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

	weaponLoadList.forEach((item) => {
		gltfLoader.load(item.url, (gltf) => {
			setupModelMaterials(gltf.scene);
			const tpl = item.skinned ? extractSkinnedWeapon(gltf.scene) : (item.prepare ? item.prepare(gltf.scene) : gltf.scene);
			item.assign(tpl, gltf.animations || []);
			if (currentLoadout && currentLoadout.gun === item.key) rebuildWeaponMesh();
			if (typeof updateLoadoutViewer === 'function' && !document.getElementById('loadout-screen').classList.contains('hidden')) {
				updateLoadoutViewer();
			}
			checkComplete();
		}, undefined, (err) => {
			console.warn(`Could not load ${item.key} (${item.url}):`, err);
			checkComplete();
		});
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

	Object.entries(GRIP_MODELS).forEach(([type, cfg]) => {
		gltfLoader.load(cfg.url, (gltf) => {
			setupModelMaterials(gltf.scene);
			// no environment map in the scene, so a fully metallic material renders almost black: soften it
			gltf.scene.traverse((o) => {
				if (!o.isMesh || !o.material || o.material.userData.gripTuned) return;
				o.material.userData.gripTuned = true;
				if (o.material.metalness > 0.45) o.material.metalness = 0.45;
				if (o.material.roughness < 0.5) o.material.roughness = 0.5;
			});
			gripTemplates[type] = gltf.scene; delete _gripFit[type];
			if ((currentLoadout.handle || 'none') === type) rebuildWeaponMesh();
			if (typeof updateLoadoutViewer === 'function' && !document.getElementById('loadout-screen').classList.contains('hidden')) updateLoadoutViewer();
			checkComplete();
		}, undefined, (err) => {
			console.warn(`[grip] could not load ${cfg.url}; the "${type}" grip falls back to a simple shape.`, err);
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
		key: 'm4a1',
		mixer, actions, mainAction,
		duration: mainAction ? mainAction.getClip().duration : 0,
		emptyMags: emptyMag ? [emptyMag] : [], fullMags: fullMag ? [fullMag] : [],
		boltNodes: [], barrelNodes: [],
		glbMag, procMag: null, magOutAt: 0.9, magInAt: 1.25,
		reloading: false, procReload: false, procTime: 0, timeScale: 1.0, boltKick: 0, pose: 0
	};
	if (emptyMag) emptyMag.visible = false;
	if (fullMag) fullMag.visible = glbMag;
	return { node: outer, anim };
}

function buildConfiguredGlb(key, template, clips, scale, origin, loadout) {
	const cfg = WEAPON_PARTS[key];
	const model = cloneWeaponModel(template);
	const emptyMags = resolveParts(model, cfg.emptyMag);
	const fullMags = resolveParts(model, cfg.fullMag);
	const boltNodes = resolveParts(model, cfg.bolt);
	const barrelNodes = resolveParts(model, cfg.barrels);
	const sights = resolveParts(model, cfg.sights);
	const scopes = resolveParts(model, cfg.scope);
	setVisible(resolveParts(model, cfg.hidden), false);
	const gripParts = resolveParts(model, cfg.gripParts);
	if (gripParts.length) setVisible(gripParts, (loadout.handle || 'none') === (cfg.gripShowOn || 'stubby'));
	else if (cfg.gripParts) console.warn('[' + key + '] built-in grip part not found: ' + cfg.gripParts.join(', '));

	fullMags.forEach((m) => { if (!m.userData.basePos) m.userData.basePos = m.position.clone(); });
	boltNodes.forEach((b) => { if (!b.userData.basePos) b.userData.basePos = b.position.clone(); });
	barrelNodes.forEach((b) => { if (!b.userData.baseRot) b.userData.baseRot = b.rotation.clone(); });

	const scopeKey = loadout.scope || 'iron';
	if (scopeKey !== 'iron') setVisible(sights, false);
	setVisible(scopes, scopeKey === cfg.scopeShowOn);
	const glbMag = (loadout.mag || 'standard') === 'standard';
	const mixer = new THREE.AnimationMixer(model);
	let mainAction = null;
	const actions = (clips || []).map((clip) => {
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

	const clipDuration = mainAction ? mainAction.getClip().duration : (cfg.procDuration || 1.8);
	const emptyEnd = animEndFor(emptyMags, clips || []);
	const magOutAt = cfg.magOutAt != null ? cfg.magOutAt : (emptyEnd || clipDuration * 0.45);
	const magInAt = cfg.magInAt != null ? cfg.magInAt : magOutAt;

	const anim = {
		key,
		mixer, actions, mainAction, duration: clipDuration,
		emptyMags, fullMags, boltNodes, barrelNodes,
		glbMag, procMag: null,
		magOutAt, magInAt,
		hasScope: scopes.length > 0, outer,
		reloading: false, procReload: actions.length === 0, procTime: 0, timeScale: 1.0, boltKick: 0, pose: 0
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
		}
	}
	if (gripParts.length) outer.userData.builtInGrip = cfg.gripShowOn || 'stubby';
	return { node: outer, anim };
}

function buildAWPGlb(loadout) { return buildConfiguredGlb('AWP', AWPTemplate, AWPClips, AWP_MODEL_SCALE, AWP_ORIGIN, loadout); }
function buildMp5Glb(loadout) { return buildConfiguredGlb('mp5', mp5Template, mp5Clips, MP5_MODEL_SCALE, MP5_ORIGIN, loadout); }
function buildSvdGlb(loadout) { return buildConfiguredGlb('svd', svdTemplate, svdClips, SVD_MODEL_SCALE, ZERO_ORIGIN, loadout); }
function buildToz34Glb(loadout) { return buildConfiguredGlb('toz34', toz34Template, toz34Clips, TOZ34_MODEL_SCALE, ZERO_ORIGIN, loadout); }
function buildBenelliM4Glb(loadout) { return buildConfiguredGlb('benellim4', benellim4Template, benellim4Clips, BENELLIM4_MODEL_SCALE, ZERO_ORIGIN, loadout); }
function buildG17Glb(loadout) { return buildConfiguredGlb('g17', g17Template, g17Clips, G17_MODEL_SCALE, ZERO_ORIGIN, loadout); }
function buildM249Glb(loadout) { return buildConfiguredGlb('m249', m249Template, m249Clips, M249_MODEL_SCALE, ZERO_ORIGIN, loadout); }
function buildUziGlb(loadout) { return buildConfiguredGlb('uzi', uziTemplate, uziClips, UZI_MODEL_SCALE, ZERO_ORIGIN, loadout); }

/* ======================================================================
MELEE MODELS
The bayonet's orientation is NOT assumed: analyzeMeleeModel() reads the mesh vertices and works out
  - the blade axis (longest principal axis),
  - which end is the tip (the end whose cross-section is smaller),
  - which side is the spine (the side the muzzle ring sticks out on; the sawback is on the same side).
buildMeleeMesh then rotates the knife so the tip points forward (-Z), the spine is up (+Y) and the
cutting edge faces down, scales it to a real-world length and pivots it on the middle of the handle.
====================================================================== */
const MELEE_MODELS = {
	bayonet: {
		length: 0.30,    // overall length in metres, tip to pommel
		gripFrac: 0.80   // centre of the gripping hand as a fraction of the length measured from the tip
	}
};

/* ----------------------------------------------------------------------
Knife poses per action. pos is in metres, rot in DEGREES (x, y, z), both relative to the held-weapon origin.
  idle  - doing nothing
  swing - right swing (LMB); the left swing is this same pose mirrored sideways
  heavy - heavy attack / stab (RMB)
The knife blends idle -> action pose -> idle while an attack plays (see updateMeleePose, called from updateMelee).
Live tuning from the browser console with the bayonet equipped (press 3):
  tuneMelee([x, y, z], [rotX, rotY, rotZ], 'idle' | 'swing' | 'heavy')   edits that pose and previews it
  tuneMelee(null, null, 'swingLeft')                                    previews the mirrored left swing
  tuneMelee(null, null, 'idle')                                         back to normal
---------------------------------------------------------------------- */
const MELEE_POSES = {
	idle:  { pos: [0, 0, 0], rot: [30, 200, 180] },
	swing: { pos: [0, 0, 0], rot: [30, 200, 180] },
	heavy: { pos: [0, 0, 0], rot: [30, 200, 180] }
};
let meleePreview = 'idle';

window.tuneMelee = function (pos, rot, which = 'idle') {
	const name = which === 'swingLeft' ? 'swing' : which;
	const p = MELEE_POSES[name];
	if (!p) { console.warn('[melee] unknown pose', which); return; }
	if (which !== 'swingLeft') { if (pos) p.pos = pos; if (rot) p.rot = rot; }
	meleePreview = which;
	console.log('[melee] ' + which + ' =', JSON.stringify(p));
};

/* Blend pose a -> b by k (0..1). mirror flips b sideways (position x, yaw and roll negated, model scaled -1 on x). */
function applyMeleePose(group, a, b, k, mirror) {
	const m = mirror ? -1 : 1, D = Math.PI / 180;
	const wrap = (d) => ((d + 540) % 360) - 180; // shortest way round
	const bp = [b.pos[0] * m, b.pos[1], b.pos[2]];
	const br = [b.rot[0], b.rot[1] * m, b.rot[2] * m];
	group.position.set(
		a.pos[0] + (bp[0] - a.pos[0]) * k,
		a.pos[1] + (bp[1] - a.pos[1]) * k,
		a.pos[2] + (bp[2] - a.pos[2]) * k
	);
	group.rotation.set(
		(a.rot[0] + wrap(br[0] - a.rot[0]) * k) * D,
		(a.rot[1] + wrap(br[1] - a.rot[1]) * k) * D,
		(a.rot[2] + wrap(br[2] - a.rot[2]) * k) * D
	);
	const sx = 1 - 2 * k * (mirror ? 1 : 0); // flips through a thin sliver instead of popping
	group.scale.x = Math.abs(sx) < 0.02 ? (sx < 0 ? -0.02 : 0.02) : sx;
}

function updateMeleePose() {
	if (!customGunMesh || !customGunMesh.userData || !customGunMesh.userData.isMelee) return;
	const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
	let target = MELEE_POSES.idle, k = 0, mirror = false;
	if (typeof meleeState !== 'undefined' && meleeState.active) {
		const heavy = meleeState.type === 'stab';
		target = heavy ? MELEE_POSES.heavy : MELEE_POSES.swing;
		mirror = !heavy && meleeState.side < 0;
		const t = meleeState.t;
		k = sm(t / 0.25) * (1 - sm((t - 0.65) / 0.35));
	} else if (meleePreview !== 'idle') {
		target = MELEE_POSES[meleePreview === 'swingLeft' ? 'swing' : meleePreview];
		k = 1; mirror = meleePreview === 'swingLeft';
	}
	applyMeleePose(customGunMesh, MELEE_POSES.idle, target, k, mirror);
}

function analyzeMeleeModel(model, gripFrac) {
	model.updateMatrixWorld(true);
	const pts = [], v = new THREE.Vector3();
	model.traverse((o) => {
		if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
		const pos = o.geometry.attributes.position;
		const step = Math.max(1, Math.floor(pos.count / 4000));
		for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
	});
	if (pts.length < 30) return null;

	// principal (longest) axis by power iteration on the covariance matrix
	const mean = new THREE.Vector3();
	pts.forEach((p) => mean.add(p));
	mean.divideScalar(pts.length);
	let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
	pts.forEach((p) => {
		const x = p.x - mean.x, y = p.y - mean.y, z = p.z - mean.z;
		cxx += x * x; cxy += x * y; cxz += x * z; cyy += y * y; cyz += y * z; czz += z * z;
	});
	const cov = new THREE.Matrix3().set(cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz);
	const e = new THREE.Vector3(1, 0.63, 0.37).normalize();
	for (let i = 0; i < 80; i++) { e.applyMatrix3(cov); if (e.lengthSq() < 1e-20) return null; e.normalize(); }

	const along = (p) => (p.x - mean.x) * e.x + (p.y - mean.y) * e.y + (p.z - mean.z) * e.z;
	let tMin = Infinity, tMax = -Infinity;
	pts.forEach((p) => { const t = along(p); if (t < tMin) tMin = t; if (t > tMax) tMax = t; });
	const L = tMax - tMin;
	if (!(L > 1e-6)) return null;
	const radial = (p, t) => Math.hypot(p.x - mean.x - e.x * t, p.y - mean.y - e.y * t, p.z - mean.z - e.z * t);

	// the tip is the end with the smaller cross-section
	let rLow = 0, rHigh = 0;
	pts.forEach((p) => {
		const t = along(p);
		if (t < tMin + 0.06 * L) rLow = Math.max(rLow, radial(p, t));
		if (t > tMax - 0.06 * L) rHigh = Math.max(rHigh, radial(p, t));
	});
	const tipAtMin = rLow <= rHigh;
	const f = tipAtMin ? e.clone().negate() : e.clone(); // direction pointing out of the tip
	const tipT = tipAtMin ? tMin : tMax;
	const dist = (p) => Math.abs(along(p) - tipT) / L;   // 0 at the tip, 1 at the pommel

	// two axes perpendicular to the blade
	const helper = Math.abs(e.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
	const a = new THREE.Vector3().crossVectors(e, helper).normalize();
	const b = new THREE.Vector3().crossVectors(e, a).normalize();
	const toAB = (p) => {
		const t = along(p);
		const qx = p.x - mean.x - e.x * t, qy = p.y - mean.y - e.y * t, qz = p.z - mean.z - e.z * t;
		return [qx * a.x + qy * a.y + qz * a.z, qx * b.x + qy * b.y + qz * b.z];
	};

	// blade width direction (spine <-> edge): major axis of the cross-section of the plain blade
	let suu = 0, svv = 0, suv = 0;
	pts.forEach((p) => {
		const d = dist(p);
		if (d < 0.08 || d > 0.45) return;
		const [u, w] = toAB(p);
		suu += u * u; svv += w * w; suv += u * w;
	});
	const theta = 0.5 * Math.atan2(2 * suv, suu - svv);
	const width = a.clone().multiplyScalar(Math.cos(theta)).addScaledVector(b, Math.sin(theta)).normalize();

	// spine = the side the muzzle ring / guard sticks out on (it reaches much further than the quillon)
	let wMax = 0, wMin = 0;
	pts.forEach((p) => {
		const d = dist(p);
		if (d < 0.45 || d > 0.72) return;
		const [u, w] = toAB(p);
		const s = u * Math.cos(theta) + w * Math.sin(theta);
		if (s > wMax) wMax = s;
		if (s < wMin) wMin = s;
	});
	const up = width.clone();
	if (-wMin > wMax) up.negate();
	up.addScaledVector(f, -up.dot(f)).normalize();
	const side = new THREE.Vector3().crossVectors(f, up).normalize(); // becomes +X (right)

	// centre of the gripping hand: centroid of a handle slab, so the pivot sits on the handle's own axis
	const grip = new THREE.Vector3(); let n = 0;
	pts.forEach((p) => {
		if (Math.abs(dist(p) - gripFrac) <= 0.07) { grip.add(p); n++; }
	});
	if (n < 5) grip.copy(mean).addScaledVector(f, (0.5 - gripFrac) * L); else grip.divideScalar(n);

	return { f, up, side, L, grip };
}

function buildMeleeMesh(key) {
	const cfg = MELEE_MODELS[key];
	const group = new THREE.Group();
	group.name = 'model';
	group.userData.isMelee = true;
	const tpl = key === 'bayonet' ? bayonetTemplate : null;
	if (!cfg || !tpl) return group; // template not loaded yet: rebuildWeaponMesh() runs again once it is

	const model = tpl.clone(true);
	const info = analyzeMeleeModel(model, cfg.gripFrac);
	if (!info) { console.warn('[melee] could not analyse the bayonet mesh'); return group; }

	const inner = new THREE.Group();
	inner.add(model);
	inner.position.copy(info.grip).negate(); // pivot on the middle of the handle

	const holder = new THREE.Group();
	holder.add(inner);
	holder.scale.setScalar(cfg.length / info.L);
	// rows of the rotation: model right -> +X, model spine -> +Y, model tip direction -> -Z
	const { f, up, side } = info;
	const basis = new THREE.Matrix4().set(
		side.x, side.y, side.z, 0,
		up.x, up.y, up.z, 0,
		-f.x, -f.y, -f.z, 0,
		0, 0, 0, 1
	);
	holder.quaternion.setFromRotationMatrix(basis);

	group.add(holder);
	applyMeleePose(group, MELEE_POSES.idle, MELEE_POSES.idle, 0, false);
	return group;
}

function buildAnyWeaponGlb(gunType, loadout) {
	switch (gunType) {
		case 'm4a1': return m4a1Template ? buildM4a1Glb(loadout) : null;
		case 'AWP': return AWPTemplate ? buildAWPGlb(loadout) : null;
		case 'mp5': return mp5Template ? buildMp5Glb(loadout) : null;
		case 'svd': return svdTemplate ? buildSvdGlb(loadout) : null;
		case 'toz34': return toz34Template ? buildToz34Glb(loadout) : null;
		case 'benellim4': return benellim4Template ? buildBenelliM4Glb(loadout) : null;
		case 'g17': return g17Template ? buildG17Glb(loadout) : null;
		case 'm249': return m249Template ? buildM249Glb(loadout) : null;
		case 'uzi': return uziTemplate ? buildUziGlb(loadout) : null;
		default: return null;
	}
}

/* ======================================================================
SHELL EJECTION
====================================================================== */
const SHELL_WEAPONS = {
	m4a1:      { node: 'Object_38',  port: new THREE.Vector3(0.035, 0.045, -0.12), length: 0.045 },
	AWP:       { node: 'Object_4',   port: new THREE.Vector3(0.035, 0.035, -0.10), length: 0.060 },
	mp5:       { node: 'Object_7_1', port: new THREE.Vector3(0.035, 0.040, -0.08), length: 0.030 },
	svd:       { node: 'shell_mesh', port: new THREE.Vector3(0.038, 0.042, -0.12), length: 0.054 },
	toz34:     { node: 'Object_4',   port: new THREE.Vector3(0.030, 0.040, -0.15), length: 0.065 },
	benellim4: { node: 'Object_12',  port: new THREE.Vector3(0.038, 0.042, -0.14), length: 0.062 },
	g17:       { node: 'Object_25',  port: new THREE.Vector3(0.026, 0.050, -0.16), length: 0.026 },
	m249:      { node: 'shell_mesh', port: new THREE.Vector3(0.042, 0.040, -0.14), length: 0.045 },
	uzi:       { node: 'shell_mesh', port: new THREE.Vector3(0.032, 0.048, -0.14), length: 0.028 }
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
	if (weaponAnim && weaponAnim.boltNodes && weaponAnim.boltNodes.length) {
		weaponAnim.boltKick = 1.0;
	}
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
	const local = camera.worldToLocal(pivot.position.clone());
	if (SHELL_CONFIG.useFixedPort || local.length() > 1.5 || local.length() < 0.05) {
		gunGroup.updateWorldMatrix(true, false);
		pivot.position.copy(gunGroup.localToWorld(wcfg.port.clone()));
	}
	pivot.position.add(SHELL_CONFIG.offset.clone().applyQuaternion(camQ));
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

const SCOPE_TUNE = {
	'm4a1:reddot': { y: -0.018, x: 0, z: -0.046 },
	'AWP:reddot': { y: -0.004, x: -0.014, z: -0.088 },
	'mp5:reddot': { y: -0.029, x: 0.015, z: -0.287 },
	'm4a1:acog': { y: -0.0169, x: -0.006, z: -0.04 },
	'AWP:acog': { y: -0.009, x: -0.0171, z: -0.08 },
	'mp5:acog': { y: -0.0223, x: 0.0068, z: -0.24 },
	'm4a1:sniper': { y: -0.0138, x: -0.0021, z: -0.0532 },
	'mp5:sniper': { y: -0.0227, x: 0.009, z: -0.29 },

	// --- seated on each gun's own receiver/rail (offsets from the per-gun default rail point in game.js) ---
	// M249: sits on the feed-cover rail, ahead of the rear sight
	'm249:reddot':  { y: -0.058, x: 0, z: -0.25 },
	'm249:acog':    { y: -0.058, x: 0, z: -0.26 },
	'm249:sniper':  { y: -0.058, x: 0, z: -0.20 },
	// Uzi: on the top cover, over the rear half of the receiver
	'uzi:reddot':   { y:  0.000, x: 0, z: -0.02 },
	'uzi:acog':     { y:  0.000, x: 0, z: -0.04 },
	'uzi:sniper':   { y:  0.000, x: 0, z: -0.12 },
	// G17: on the MOS plate, rear half of the slide (sights cover is hidden when an optic is fitted)
	'g17:reddot':   { y: -0.008, x: 0, z:  0.00 },
	'g17:acog':     { y: -0.008, x: 0, z: -0.03 },
	'g17:sniper':   { y: -0.008, x: 0, z: -0.03 },
	// SVD: on the dust cover, clear of the rear sight block, eyepiece kept off the stock
	'svd:reddot':   { y: -0.025, x: -0.014, z: -0.22 },
	'svd:acog':     { y: -0.025, x: -0.014, z: -0.21 },
	'svd:sniper':   { y: -0.025, x: -0.014, z: -0.20 },
	// TOZ-34: on the barrel rib just ahead of the breech
	'toz34:reddot': { y:  0.000, x: 0, z: -0.20 },
	'toz34:acog':   { y:  0.000, x: 0, z: -0.20 },
	'toz34:sniper': { y:  0.000, x: 0, z: -0.17 },
	// Benelli M4: on the receiver Picatinny rail, in front of the ghost-ring sight
	'benellim4:reddot': { y: -0.016, x: 0, z: -0.24 },
	'benellim4:acog':   { y: -0.016, x: 0, z: -0.22 },
	'benellim4:sniper': { y: -0.016, x: 0, z: -0.19 },
};

const SCOPE_ADS_TUNE = {
	'm4a1:reddot': { x: -0.0012, y: -0.0685, z: 0.09 },
	'AWP:reddot': { x: -0.0152, y: -0.0693, z: 0.03 },
	'mp5:reddot': { x: 0.0088, y: -0.0128, z: -0.11 },
	'm4a1:acog': { y: -0.0855, x: -0.0031, z: 0 },
	'AWP:acog': { y: -0.0861, x: -0.0171, z: -0.04 },
	'mp5:acog': { y: -0.0866, x: 0.0068, z: -0.21 },
	'm4a1:sniper': { y: -0.0526, x: -0.0026, z: 0.17 },
	'mp5:sniper': { y: -0.0505, x: 0.0076, z: 0 },

	// ADS: optic centred on screen. x/y depend only on the optic (same for every gun);
	// z = (eye-relief target) - <GUN>_ADS_Z - railCenterZ, so it differs per gun.
	'm249:reddot':  { y: -0.069,  x: -0.0012, z: 0.16 },
	'm249:acog':    { y: -0.0858, x: -0.0031, z: 0.07 },
	'm249:sniper':  { y: -0.0526, x: -0.0025, z: 0.25 },
	'uzi:reddot':   { y: -0.069,  x: -0.0012, z: 0.16 },
	'uzi:acog':     { y: -0.0858, x: -0.0031, z: 0.07 },
	'uzi:sniper':   { y: -0.0526, x: -0.0025, z: 0.25 },
	'g17:reddot':   { y: -0.069,  x: -0.0012, z: 0.14 },
	'g17:acog':     { y: -0.0858, x: -0.0031, z: 0.05 },
	'g17:sniper':   { y: -0.0526, x: -0.0025, z: 0.23 },
	'svd:reddot':   { y: -0.069,  x: -0.0012, z: 0.12 },
	'svd:acog':     { y: -0.0858, x: -0.0031, z: 0.03 },
	'svd:sniper':   { y: -0.0526, x: -0.0025, z: 0.21 },
	'toz34:reddot': { y: -0.069,  x: -0.0012, z: 0.16 },
	'toz34:acog':   { y: -0.0858, x: -0.0031, z: 0.07 },
	'toz34:sniper': { y: -0.0526, x: -0.0025, z: 0.25 },
	'benellim4:reddot': { y: -0.069,  x: -0.0012, z: 0.14 },
	'benellim4:acog':   { y: -0.0858, x: -0.0031, z: 0.05 },
	'benellim4:sniper': { y: -0.0526, x: -0.0025, z: 0.23 },
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
	if (!(delta > 0) || !isFinite(_adsBlend)) _adsBlend = target;
	else _adsBlend += (target - _adsBlend) * (1 - Math.exp(-SCOPE_ADS_BLEND_SPEED * delta));
	if (Math.abs(target - _adsBlend) < 0.001) _adsBlend = target;
	optic.position.set(
		hipPos.x + (adsPos.x - hipPos.x) * _adsBlend,
		hipPos.y + (adsPos.y - hipPos.y) * _adsBlend,
		hipPos.z + (adsPos.z - hipPos.z) * _adsBlend
	);
}

let activeTuneMode = 'gun';
let _tuneManualGun = false;

function autoTuneMode() {
	const scope = currentLoadout && currentLoadout.scope;
	if (!scope || scope === 'iron') return 'gun';
	return (typeof isADS !== 'undefined' && isADS) ? 'scope_ads' : 'scope_hip';
}

function syncTuneMode() {
	if (!adsTuneOn || _tuneManualGun) return;
	const m = autoTuneMode();
	if (m !== activeTuneMode) { activeTuneMode = m; updateTuneHud(); }
}

function updateTuneHud(msg) {
	if (!_tuneHud || !customGunMesh) return;
	const ud = customGunMesh.userData || {};
	const key = adsTuneKey();
	let x, y, z, title;
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
	_tuneHud.innerHTML =
		`<b>${title}</b> &nbsp;${key}<br>` +
		`X ${x.toFixed(4)} &nbsp; Y ${y.toFixed(4)} &nbsp; Z ${z.toFixed(4)}<br>` +
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
	} else {
		if (_tuneStyle) _tuneStyle.remove();
		if (_tuneHud) _tuneHud.remove();
		_tuneStyle = _tuneHud = null;
		if (_savedSniperOverlay !== null && typeof ATTACHMENTS !== 'undefined') {
			ATTACHMENTS.scope.sniper.useSniperOverlay = _savedSniperOverlay;
			_savedSniperOverlay = null;
		}
	}
}

function playReloadAnimation() {
	const a = weaponAnim;
	if (!a) return 1400;
	if (a.actions && a.actions.length) {
		a.mixer.timeScale = currentLoadout.gun === 'AWP' ? AWP_RELOAD_SPEED : (currentLoadout.gun === 'mp5' ? MP5_RELOAD_SPEED : M4A1_RELOAD_SPEED);
		a.actions.forEach((act) => { act.reset(); act.play(); });
		a.reloading = true;
		return (a.duration / a.mixer.timeScale) * 1000;
	}
	a.procReload = true;
	a.reloading = true;
	a.procTime = 0;
	return a.duration * 1000;
}

function updateWeaponAnim(delta) {
	applyAdsTune();
	applyScopeTune(delta);
	try { syncTuneMode(); } catch (err) {}
	updateShells(delta);
	const a = weaponAnim;
	if (!a) return;

	let t = 0;
	if (a.actions && a.actions.length) {
		a.mixer.update(delta);
		t = a.mainAction ? a.mainAction.time : 0;
		if (a.reloading && t >= a.duration - 0.001) a.reloading = false;
	} else if (a.reloading) {
		a.procTime += delta * (a.timeScale || 1.0);
		t = a.procTime;
		if (t >= a.duration) {
			a.reloading = false;
			a.procTime = 0;
		}
	}

	const rl = a.reloading;
	const outAt = a.magOutAt != null ? a.magOutAt : 0.9;
	const inAt = a.magInAt != null ? a.magInAt : 1.25;

	if (a.actions && a.actions.length) {
		a.emptyMags.forEach((m) => { m.visible = a.glbMag && rl && t < outAt; });
		a.fullMags.forEach((m) => { m.visible = a.glbMag && (!rl || t >= inAt); });
	} else {
		// Procedural part animation for static/skinned GLB weapons without embedded animation clips
		const p = rl ? Math.min(1, t / Math.max(0.01, a.duration)) : 0;
		const scaleInv = a.outer ? (1 / Math.max(0.0001, a.outer.scale.x)) : 1;

		// Break-action barrels on TOZ-34
		if (a.barrelNodes && a.barrelNodes.length) {
			const breakEnv = rl ? (p < 0.18 ? p / 0.18 : (p < 0.78 ? 1 : 1 - (p - 0.78) / 0.22)) : 0;
			a.barrelNodes.forEach((b) => {
				if (b.userData.baseRot) {
					b.rotation.z = b.userData.baseRot.z - breakEnv * 0.55;
				}
			});
		}

		// Magazine drop & re-insert
		a.fullMags.forEach((m) => {
			m.visible = a.glbMag;
			if (!m.userData.basePos) return;
			if (!rl) {
				m.position.copy(m.userData.basePos);
				return;
			}
			let drop = 0;
			if (p < 0.35) drop = p / 0.35;
			else if (p < 0.55) { drop = 1.0; m.visible = false; }
			else if (p < 0.82) drop = 1.0 - (p - 0.55) / 0.27;
			m.position.y = m.userData.basePos.y - drop * 0.16 * scaleInv;
		});

		// Bolt / slide reciprocation on shot + rack at end of reload
		if (a.boltKick > 0) a.boltKick = Math.max(0, a.boltKick - delta * 14);
		let rack = a.boltKick;
		if (rl && p > 0.82) {
			rack = Math.max(rack, Math.sin(((p - 0.82) / 0.18) * Math.PI));
		}
		a.boltNodes.forEach((b) => {
			if (!b.userData.basePos) return;
			b.position.x = b.userData.basePos.x - rack * 0.045 * scaleInv;
		});
	}

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
		const isSniper = scopeType === 'sniper';
		const optic = customGunMesh.getObjectByName('optic');
		const gunModel = customGunMesh.getObjectByName('model') || customGunMesh.children[0];
		const cyclingBolt = typeof isBoltCycling !== 'undefined' && isBoltCycling;

		if (isADS && !cyclingBolt) {
			if (!isIron) {
				if (gunModel) gunModel.visible = false;
				if (optic) {
					optic.visible = true;
					optic.traverse((o) => {
						if (!o.isMesh || !o.material) return;
						if (isSniper && !o.userData.adsTransparent) {
							o.material = o.material.clone();
							o.material.transparent = true;
							o.material.opacity = 0.1;
							o.material.depthWrite = false;
							o.userData.adsTransparent = true;
						} else if (!isSniper && o.userData.adsTransparent) {
							o.material.opacity = 1;
							o.material.depthWrite = true;
							o.userData.adsTransparent = false;
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