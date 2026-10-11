/*
 * gunsLoad.js
 * External GLB model loading for M4A1, AWP Sniper, and MP5,
 * reload animations, and user-imported Blender GLB/GLTF model controls.
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

const M4A1_IRON_AIM_Y = 0.09;
const AWP_IRON_AIM_Y = 0.09;
const MP5_IRON_AIM_Y = 0.09;

const M4A1_ORIGIN = new THREE.Vector3(-0.9, 0.22, 0);
const AWP_ORIGIN = new THREE.Vector3(0.0202, 0.0615, 0.0007);;
const MP5_ORIGIN = new THREE.Vector3(-0.9, 0.22, 0);

// Parsed GLB templates and animation clips
let m4a1Template = null, m4a1Clips = [];
let AWPTemplate = null, AWPClips = [];
let mp5Template = null, mp5Clips = [];
let weaponAnim = null; // Runtime state for the currently held GLB weapon

// Helper to convert glTF linear colors to sRGB for consistent renderer brightness
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
    const totalModels = 3;

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

    // 1. Load M4A1
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

    // 2. Load AWP / AWP Sniper
    gltfLoader.load(AWP_MODEL_URL, (gltf) => {
        setupModelMaterials(gltf.scene);
        AWPTemplate = gltf.scene;
        AWPClips = gltf.animations || [];
        if (currentLoadout.gun === 'AWP') rebuildWeaponMesh();
        checkComplete();
    }, undefined, (err) => {
        console.error('Failed to load AWP/AWP:', err);
        checkComplete();
    });

    // 3. Load MP5
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
        emptyMag, fullMag, glbMag, procMag: null,
        reloading: false, pose: 0
    };
    if (emptyMag) emptyMag.visible = false;
    if (fullMag) fullMag.visible = glbMag;
    return { node: outer, anim };
}

function buildAWPGlb(loadout) {
    const model = AWPTemplate.clone(true);
    const mixer = new THREE.AnimationMixer(model);
    let mainAction = null;
    const actions = AWPClips.map((clip) => {
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
    outer.scale.setScalar(AWP_MODEL_SCALE);
    outer.rotation.y = Math.PI / 2;
    model.position.copy(AWP_ORIGIN).negate();
    outer.add(model);

    const anim = {
        mixer, actions, mainAction,
        duration: mainAction ? mainAction.getClip().duration : 0,
        emptyMag: null, fullMag: null, glbMag: true, procMag: null,
        reloading: false, pose: 0
    };
    return { node: outer, anim };
}

function buildMp5Glb(loadout) {
    const model = mp5Template.clone(true);
    const mixer = new THREE.AnimationMixer(model);
    let mainAction = null;
    const actions = mp5Clips.map((clip) => {
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
    outer.scale.setScalar(MP5_MODEL_SCALE);
    outer.rotation.y = Math.PI / 2;
    model.position.copy(MP5_ORIGIN).negate();
    outer.add(model);

    const anim = {
        mixer, actions, mainAction,
        duration: mainAction ? mainAction.getClip().duration : 0,
        emptyMag: null, fullMag: null, glbMag: true, procMag: null,
        reloading: false, pose: 0
    };
    return { node: outer, anim };
}

function playReloadAnimation() {
    const a = weaponAnim;
    if (!a || !a.actions.length) return 1400;
    a.mixer.timeScale = currentLoadout.gun === 'AWP' ? AWP_RELOAD_SPEED : (currentLoadout.gun === 'mp5' ? MP5_RELOAD_SPEED : M4A1_RELOAD_SPEED);
    a.actions.forEach((act) => { act.reset(); act.play(); });
    a.reloading = true;
    return (a.duration / a.mixer.timeScale) * 1000;
}

function updateWeaponAnim(delta) {
    const a = weaponAnim;
    if (!a) return;
    a.mixer.update(delta);
    const t = a.mainAction ? a.mainAction.time : 0;
    if (a.reloading && t >= a.duration - 0.001) a.reloading = false;
    const rl = a.reloading;

    if (a.emptyMag) a.emptyMag.visible = a.glbMag && rl && t < 0.9;
    if (a.fullMag) a.fullMag.visible = a.glbMag && (!rl || t >= 1.25);

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
