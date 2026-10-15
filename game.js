/*
game.js
Three.js engine, player controls/physics, bots, weapon gameplay, and audio.
Depends on Three.js + GLTFLoader and loads after gunsLoad.js.
*/

/* Tactical Settings & Preference Management */
const defaultSettings = { fov: 78, volume: 1.0, sensitivity: 1.0 };
let gameSettings = Object.assign({}, defaultSettings);
try {
    const saved = localStorage.getItem('pf3d_settings');
    if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.fov === 'number' && !isNaN(parsed.fov)) gameSettings.fov = parsed.fov;
        if (typeof parsed.volume === 'number' && !isNaN(parsed.volume)) gameSettings.volume = parsed.volume;
        if (typeof parsed.sensitivity === 'number' && !isNaN(parsed.sensitivity)) gameSettings.sensitivity = parsed.sensitivity;
    }
} catch (e) { }

function saveSettings() {
    try { localStorage.setItem('pf3d_settings', JSON.stringify(gameSettings)); } catch (e) { }
}

/* Web Audio Sound Synthesizer with Master Volume */
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let masterGain = null;

function initAudioContext() {
    if (!audioCtx && AudioContextClass) {
        audioCtx = new AudioContextClass();
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(gameSettings.volume, audioCtx.currentTime);
        masterGain.connect(audioCtx.destination);
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });
}

function setMasterVolume(vol) {
    gameSettings.volume = Math.max(0, Math.min(1, vol));
    if (masterGain && audioCtx) masterGain.gain.setValueAtTime(gameSettings.volume, audioCtx.currentTime);
}

function playGunshotSound(type = 'm4a1') {
    try {
        initAudioContext();
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const now = audioCtx.currentTime;
        osc.connect(gain);
        gain.connect(masterGain || audioCtx.destination);
        
        if (currentLoadout && currentLoadout.muzzle === 'suppressor') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(420, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.09);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
            osc.start(now); osc.stop(now + 0.09); return;
        }
        if (type === 'AWP') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(260, now);
            osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);
            gain.gain.setValueAtTime(0.55, now); gain.gain.exponentialRampToValueAtTime(0.005, now + 0.45);
            osc.start(now); osc.stop(now + 0.45);
        } else if (type === 'mp5') {
            osc.type = 'square'; osc.frequency.setValueAtTime(700, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
            gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        } else {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
            gain.gain.setValueAtTime(0.28, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now); osc.stop(now + 0.15);
        }
    } catch (err) { }
}

function playHitmarkerSound() {
    try {
        initAudioContext(); if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const now = audioCtx.currentTime;
        osc.type = 'sine'; osc.frequency.setValueAtTime(950, now);
        gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.connect(gain); gain.connect(masterGain || audioCtx.destination);
        osc.start(now); osc.stop(now + 0.07);
    } catch (err) { }
}

function playHeadshotSound() {
    try {
        initAudioContext(); if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const osc1 = audioCtx.createOscillator(); const gain1 = audioCtx.createGain();
        osc1.type = 'sine'; osc1.frequency.setValueAtTime(2600, now);
        osc1.frequency.exponentialRampToValueAtTime(1850, now + 0.16);
        gain1.gain.setValueAtTime(0.50, now); gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc1.connect(gain1); gain1.connect(masterGain || audioCtx.destination);
        osc1.start(now); osc1.stop(now + 0.16);
        
        const osc2 = audioCtx.createOscillator(); const gain2 = audioCtx.createGain();
        osc2.type = 'triangle'; osc2.frequency.setValueAtTime(3600, now);
        osc2.frequency.exponentialRampToValueAtTime(2400, now + 0.12);
        gain2.gain.setValueAtTime(0.35, now); gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc2.connect(gain2); gain2.connect(masterGain || audioCtx.destination);
        osc2.start(now); osc2.stop(now + 0.12);
        
        const osc3 = audioCtx.createOscillator(); const gain3 = audioCtx.createGain();
        osc3.type = 'sawtooth'; osc3.frequency.setValueAtTime(220, now);
        osc3.frequency.exponentialRampToValueAtTime(45, now + 0.06);
        gain3.gain.setValueAtTime(0.35, now); gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc3.connect(gain3); gain3.connect(masterGain || audioCtx.destination);
        osc3.start(now); osc3.stop(now + 0.06);
    } catch (err) { }
}

/* --- Three.js Scene Setup --- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030712);
scene.fog = new THREE.FogExp2(0x030712, 0.012);

const camera = new THREE.PerspectiveCamera(gameSettings.fov || 78, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
dirLight.position.set(30, 50, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 150;
const d = 60;
dirLight.shadow.camera.left = -d; dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d; dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const pitchObject = new THREE.Object3D();
pitchObject.add(camera);
const yawObject = new THREE.Object3D();
yawObject.position.set(0, 1.6, 30);
yawObject.add(pitchObject);
scene.add(yawObject);

const controls = {
    isLocked: false,
    pitchObject: pitchObject,
    yawObject: yawObject,
    getObject: () => yawObject,
    lock: function () {
        try {
            const promise = document.body.requestPointerLock();
            if (promise && promise.catch) promise.catch(() => { });
        } catch (e) { }
    },
    unlock: function () {
        try { document.exitPointerLock(); } catch (e) { }
    }
};

document.addEventListener('pointerlockchange', () => {
    controls.isLocked = (document.pointerLockElement === document.body);
    const hud = document.getElementById('hud');
    const mainMenu = document.getElementById('main-menu');
    if (controls.isLocked) {
        hud.classList.remove('hidden');
        mainMenu.classList.add('hidden');
        document.getElementById('loadout-screen').classList.add('hidden');
        document.getElementById('settings-screen').classList.add('hidden');
    } else {
        window.isMouseDown = false;
        hud.classList.add('hidden');
        if (!isDead) mainMenu.classList.remove('hidden');
    }
});

renderer.domElement.addEventListener('click', () => {
    if (!controls.isLocked && !isDead) controls.lock();
});

document.addEventListener('mousemove', (e) => {
    if (!controls.isLocked || isDead) return;
    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;
    const sens = 0.002 * (gameSettings.sensitivity || 1.0);
    yawObject.rotation.y -= movementX * sens;
    pitchObject.rotation.x -= movementY * sens;
    pitchObject.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitchObject.rotation.x));
    targetMouseSwayX += movementX * 0.00025 * (gameSettings.sensitivity || 1.0);
    targetMouseSwayY += movementY * 0.00025 * (gameSettings.sensitivity || 1.0);
});

/* --- Weapons & Attachments --- */
const WEAPONS = {
    m4a1: { name: 'M4A1 ASSAULT RIFLE', damage: 34, fireRate: 800, recoilClimb: 0.02, recoilKickH: 0.008, gunKickZ: 0.025, gunRotX: 0.02, spreadBase: 6, spreadMax: 28, maxClip: 30, reserve: 120, type: 'PRIMARY', color: 0x38bdf8 },
    AWP: { name: 'AWP SNIPER', damage: 98, fireRate: 46, recoilClimb: 0.12, recoilKickH: 0.025, gunKickZ: 0.09, gunRotX: 0.15, spreadBase: 12, spreadMax: 45, maxClip: 5, reserve: 25, type: 'PRIMARY', color: 0xf59e0b },
    mp5: { name: 'MP5 SUBMACHINE GUN', damage: 26, fireRate: 900, recoilClimb: 0.012, recoilKickH: 0.010, gunKickZ: 0.020, gunRotX: 0.005, spreadBase: 8, spreadMax: 32, maxClip: 30, reserve: 120, type: 'PRIMARY', color: 0x10b981 }
};

const ATTACHMENTS = {
    scope: {
        iron: { name: 'Iron Sights (Fast ADS)', fovMultiplier: 0.75, useSniperOverlay: false },
        reddot: { name: 'Coyote Red Dot Sight', fovMultiplier: 0.60, useSniperOverlay: false },
        acog: { name: 'ACOG 4x Tactical Scope', fovMultiplier: 0.42, useSniperOverlay: false, recoilMod: 1.3 },
        sniper: { name: '8x High-Power Sniper Scope', fovMultiplier: 0.22, useSniperOverlay: true, recoilMod: 1.6 }
    },
    muzzle: {
        none: { name: 'Standard Flash Hider', recoilClimbMod: 1.0, recoilKickHMod: 1.0 },
        suppressor: { name: 'PBS Tactical Suppressor', recoilClimbMod: 0.78, recoilKickHMod: 0.82 },
        compensator: { name: 'Recoil Compensator', recoilClimbMod: 0.95, recoilKickHMod: 0.65 },
        brake: { name: 'Heavy Muzzle Brake', recoilClimbMod: 0.72, recoilKickHMod: 1.10 }
    },
    stock: {
        standard: { name: 'Standard Tactical Stock', recoilClimbMod: 1.0, speedMod: 1.0 },
        skeletal: { name: 'Skeletal Minimalist Stock', recoilClimbMod: 1.15, speedMod: 1.20 },
        heavy: { name: 'Heavy Sniper Stock', recoilClimbMod: 0.75, speedMod: 0.90 },
        folded: { name: 'CQB No Stock / Folded', recoilClimbMod: 1.25, speedMod: 1.25 }
    },
    mag: {
        standard: { name: 'Standard Magazine', clipMod: 1.0 },
        extended: { name: 'Extended Mag (+50%)', clipMod: 1.5 },
        drum: { name: 'High-Cap Drum Mag (+100%)', clipMod: 2.0 }
    },
    handle: {
        none: { name: 'None (Standard Handguard)', recoilClimbMod: 1.0, recoilKickHMod: 1.0 },
        vertical: { name: 'Vertical Foregrip (-Recoil)', recoilClimbMod: 0.78, recoilKickHMod: 0.90 },
        angled: { name: 'Angled Grip (+ADS Speed)', recoilClimbMod: 0.90, recoilKickHMod: 0.85 },
        stubby: { name: 'Tactical Stubby Grip (+Stability)', recoilClimbMod: 0.85, recoilKickHMod: 0.75 }
    }
};

/* SEPARATE LOADOUTS PER GUN */
const defaultLoadout = { scope: 'iron', muzzle: 'none', stock: 'standard', mag: 'standard', handle: 'none' };
const loadouts = {
    m4a1: { ...defaultLoadout, gun: 'm4a1' },   // 'gun' is required: SCOPE_TUNE / SCOPE_ADS_TUNE / ADS_TUNE keys are "<gun>:<scope>"
    AWP: { ...defaultLoadout, gun: 'AWP', scope: 'sniper' },
    mp5: { ...defaultLoadout, gun: 'mp5' }
};

let currentWeaponKey = 'm4a1';
let currentWeapon = WEAPONS.m4a1;
let currentLoadout = loadouts[currentWeaponKey];
let ammoClip = currentWeapon.maxClip;
let ammoReserve = currentWeapon.reserve;

const collidableObjects = [];
const arenaSize = 120;

function buildTacticalMap() {
    const floorGeo = new THREE.PlaneGeometry(arenaSize, arenaSize);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(arenaSize, 60, 0x0284c7, 0x1e293b);
    grid.position.y = 0.02; scene.add(grid);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
    const wallHeight = 12; const wallThickness = 2;
    const walls = [
        { size: [arenaSize, wallHeight, wallThickness], pos: [0, wallHeight / 2, -arenaSize / 2] },
        { size: [arenaSize, wallHeight, wallThickness], pos: [0, wallHeight / 2, arenaSize / 2] },
        { size: [wallThickness, wallHeight, arenaSize], pos: [-arenaSize / 2, wallHeight / 2, 0] },
        { size: [wallThickness, wallHeight, arenaSize], pos: [arenaSize / 2, wallHeight / 2, 0] },
    ];
    walls.forEach(w => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
        mesh.position.set(...w.pos); mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); collidableObjects.push(mesh);
    });

    const containerColors = [0x0284c7, 0xe11d48, 0x15803d, 0x475569];
    const containers = [
        { pos: [-15, 2.5, -20], rot: 0, colorIdx: 0 }, { pos: [-15, 7.5, -20], rot: 0, colorIdx: 1 },
        { pos: [18, 2.5, 15], rot: Math.PI / 2, colorIdx: 2 }, { pos: [-25, 2.5, 20], rot: Math.PI / 4, colorIdx: 3 },
        { pos: [25, 2.5, -25], rot: -Math.PI / 6, colorIdx: 0 },
    ];
    containers.forEach(c => {
        const mat = new THREE.MeshStandardMaterial({ color: containerColors[c.colorIdx], roughness: 0.4, metalness: 0.3 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 14), mat);
        mesh.position.set(...c.pos); mesh.rotation.y = c.rot; mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); collidableObjects.push(mesh);
    });

    const towerMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    const towers = [ { pos: [0, 4, 0], size: [16, 8, 16] }, { pos: [-35, 6, -35], size: [10, 12, 10] }, { pos: [35, 6, 35], size: [10, 12, 10] } ];
    towers.forEach(t => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...t.size), towerMat);
        mesh.position.set(...t.pos); mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); collidableObjects.push(mesh);
    });
}
buildTacticalMap();

const gunGroup = new THREE.Group();
camera.add(gunGroup);

function createProceduralWeapon(gunType = currentWeaponKey, loadout = currentLoadout) {
    const group = new THREE.Group();
    const gunmetalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.7 });
    const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.85 });
    const polymerMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.2 });
    const factionMat = new THREE.MeshStandardMaterial({
        color: gunType === 'AWP' ? 0xf59e0b : (gunType === 'mp5' ? 0x10b981 : 0x0284c7),
        metalness: 0.8, roughness: 0.35
    });

    let barrelTipZ = -0.75; let railCenterZ = -0.06; let railY = 0.08;
    let stockStartZ = 0.30; let magY = -0.12; let magZ = -0.08;
    let handleY = -0.065; let handleZ = -0.36;

    const useGlbM4 = (gunType === 'm4a1' && !!m4a1Template);
    const useGlbAWP = (gunType === 'AWP' && !!AWPTemplate);
    const useGlbMp5 = (gunType === 'mp5' && !!mp5Template);
    let glbBuild = null;

    if (useGlbAWP) {
        glbBuild = buildAWPGlb(loadout); barrelTipZ = -1.10; railCenterZ = -0.10; railY = 0.095; group.add(glbBuild.node);
    } else if (useGlbMp5) {
        glbBuild = buildMp5Glb(loadout); barrelTipZ = -0.56; railCenterZ = -0.05; railY = 0.085; group.add(glbBuild.node);
    } else if (useGlbM4) {
        glbBuild = buildM4a1Glb(loadout);
        const flatTop = loadout.scope !== 'iron';
        barrelTipZ = loadout.muzzle === 'none' ? -0.67 : -0.63;
        railCenterZ = 0.0; railY = flatTop ? 0.05 : 0.104;
        stockStartZ = 0.22; magY = -0.12; magZ = -0.08; handleY = -0.043; handleZ = -0.30;
        group.add(glbBuild.node);
    } else if (gunType === 'AWP') {
        barrelTipZ = -1.10; railCenterZ = -0.10; railY = 0.095;
        stockStartZ = 0.42; magY = -0.12; magZ = -0.04; handleY = -0.07; handleZ = -0.50;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.90), polymerMat);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.75, 12), darkSteelMat);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.72);
        group.add(body, barrel);
    } else if (gunType === 'mp5') {
        barrelTipZ = -0.56; railCenterZ = -0.05; railY = 0.085;
        stockStartZ = 0.24; magY = -0.11; magZ = -0.06; handleY = -0.06; handleZ = -0.30;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.48), gunmetalMat);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.32, 12), darkSteelMat);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.40);
        group.add(body, barrel);
    } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.60), gunmetalMat);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 12), darkSteelMat);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.52);
        group.add(body, barrel);
    }

    const muzzleType = loadout.muzzle || 'none';
    if (muzzleType === 'suppressor') {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.28, 14), darkSteelMat);
        can.rotation.x = Math.PI / 2; can.position.set(0, 0.02, barrelTipZ - 0.14); group.add(can);
    } else if (muzzleType === 'compensator') {
        const comp = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.10), factionMat);
        comp.position.set(0, 0.02, barrelTipZ - 0.05); group.add(comp);
    } else if (muzzleType === 'brake') {
        const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.12, 8), darkSteelMat);
        brake.rotation.x = Math.PI / 2; brake.position.set(0, 0.02, barrelTipZ - 0.06); group.add(brake);
    } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
        const hider = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.018, 0.06, 8), darkSteelMat);
        hider.rotation.x = Math.PI / 2; hider.position.set(0, 0.02, barrelTipZ - 0.03); group.add(hider);
    }

    const scopeType = loadout.scope || 'iron';
    const opticGroup = new THREE.Group(); opticGroup.name = 'optic';
    group.userData.adsAimY = railY + (scopeType === 'iron' ? 0.06 : 0.055);
    group.userData.scopeType = scopeType;
    group.userData.muzzleZ = barrelTipZ - (loadout.muzzle && loadout.muzzle !== 'none' ? 0.1 : 0);   // barrel tip (local space) for the bullet tracer
    group.userData.muzzleY = 0.02;

    const adsCfg = useGlbM4 ? [M4A1_IRON_AIM_Y, M4A1_ADS_X, M4A1_ADS_Z]
        : useGlbAWP ? [AWP_IRON_AIM_Y, AWP_ADS_X, AWP_ADS_Z]
        : useGlbMp5 ? [MP5_IRON_AIM_Y, MP5_ADS_X, MP5_ADS_Z] : null;
    if (adsCfg) {
        if (scopeType === 'iron') group.userData.adsAimY = adsCfg[0];
        group.userData.adsX = adsCfg[1]; group.userData.adsZ = adsCfg[2];
    }

    if (scopeType === 'reddot' || scopeType === 'acog' || scopeType === 'sniper') {
        const useBuiltInScope = scopeType === 'sniper' && glbBuild && glbBuild.anim.hasScope;
        if (!useBuiltInScope) {
            const scopeBuild = buildScopeGlb(scopeType, railY, railCenterZ);
            if (scopeBuild) { opticGroup.add(scopeBuild.node); group.userData.adsAimY = scopeBuild.aimY; }
        }
    } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
        const rear = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.02), darkSteelMat);
        rear.position.set(0, railY + 0.02, railCenterZ + 0.12);
        const front = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.02), factionMat);
        front.position.set(0, railY + 0.02, barrelTipZ + 0.08);
        opticGroup.add(rear, front);
    }
    group.add(opticGroup);

    const stockType = loadout.stock || 'standard';
    if (stockType === 'skeletal') {
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.22), factionMat);
        stock.position.set(0, -0.01, stockStartZ + 0.11); group.add(stock);
    } else if (stockType === 'heavy') {
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.18, 0.28), polymerMat);
        stock.position.set(0, -0.02, stockStartZ + 0.14);
        const riser = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.16), factionMat);
        riser.position.set(0, 0.085, stockStartZ + 0.12); group.add(stock, riser);
    } else if (stockType === 'folded') {
        const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), darkSteelMat);
        hinge.position.set(0, -0.01, stockStartZ + 0.02); group.add(hinge);
    } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.20, 10), darkSteelMat);
        tube.rotation.x = Math.PI / 2; tube.position.set(0, 0, stockStartZ + 0.10);
        const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.15, 0.16), polymerMat);
        butt.position.set(0, -0.02, stockStartZ + 0.18); group.add(tube, butt);
    }

    const magType = loadout.mag || 'standard';
    const magGroup = new THREE.Group(); magGroup.name = 'procmag';
    if (magType === 'extended') {
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.35, 0.09), darkSteelMat);
        mag.position.set(0, magY - 0.06, magZ - 0.02); mag.rotation.x = 0.25; magGroup.add(mag);
    } else if (magType === 'drum') {
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.07), darkSteelMat);
        neck.position.set(0, magY, magZ);
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.09, 16), factionMat);
        drum.rotation.z = Math.PI / 2; drum.position.set(0, magY - 0.09, magZ - 0.02); magGroup.add(neck, drum);
    } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.22, 0.085), polymerMat);
        mag.position.set(0, magY, magZ); mag.rotation.x = 0.2; magGroup.add(mag);
    }
    group.add(magGroup);

    const handleType = loadout.handle || 'none';
    if (handleType === 'vertical') {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, 0.16, 10), darkSteelMat);
        grip.position.set(0, handleY - 0.08, handleZ); group.add(grip);
    } else if (handleType === 'angled') {
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.15), factionMat);
        grip.position.set(0, handleY - 0.03, handleZ); grip.rotation.x = -0.4; group.add(grip);
    } else if (handleType === 'stubby') {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.09, 10), polymerMat);
        grip.position.set(0, handleY - 0.045, handleZ); group.add(grip);
    } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.20), darkSteelMat);
        rail.position.set(0, handleY, handleZ); group.add(rail);
    }

    group.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    if (glbBuild) { weaponAnim = glbBuild.anim; weaponAnim.procMag = weaponAnim.glbMag ? null : magGroup; }
    return group;
}

function rebuildWeaponMesh() {
    weaponAnim = null; gunGroup.clear();
    customGunMesh = createProceduralWeapon(currentWeaponKey, currentLoadout);
    gunGroup.add(customGunMesh);
}
rebuildWeaponMesh();
gunGroup.position.set(0.2, -0.22, -0.4);

/* --- Bots --- */
class Bot {
    constructor(name, startPos) {
        this.name = name; this.kills = 0; this.deaths = 0; this.score = 0; this.health = 100;
        this.mesh = new THREE.Group(); this.buildMesh();
        this.mesh.position.copy(startPos); scene.add(this.mesh);
        this.targetPos = this.getRandomTarget(); this.lastShotTime = 0;
    }
    buildMesh() {
        this.mesh.clear();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.50, 1.30, 12), new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 }));
        body.position.y = 0.65; body.castShadow = true; body.userData.isHead = false;
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.10, 8), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 }));
        neck.position.set(0, 1.33, 0); neck.userData.isHead = false;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.48), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.4 }));
        head.position.set(0, 1.56, 0); head.castShadow = true; head.userData.isHead = true;
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.12), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
        visor.position.set(0, 1.60, -0.25); visor.userData.isHead = true;
        this.mesh.add(body, neck, head, visor);
    }
    getRandomTarget() { return new THREE.Vector3((Math.random() - 0.5) * (arenaSize - 20), 0.9, (Math.random() - 0.5) * (arenaSize - 20)); }
    update(delta, playerPos) {
        if (this.health <= 0) return;
        const dir = new THREE.Vector3().subVectors(this.targetPos, this.mesh.position); dir.y = 0;
        if (dir.length() < 3) { this.targetPos = this.getRandomTarget(); }
        else { dir.normalize(); this.mesh.position.addScaledVector(dir, 5.5 * delta);
            const lookTarget = new THREE.Vector3(this.targetPos.x, this.mesh.position.y, this.targetPos.z);
            if (this.mesh.position.distanceToSquared(lookTarget) > 0.001) this.mesh.lookAt(lookTarget);
        }
        const dist = this.mesh.position.distanceTo(playerPos);
        if (dist < 32) {
            const playerLookTarget = new THREE.Vector3(playerPos.x, this.mesh.position.y, playerPos.z);
            if (this.mesh.position.distanceToSquared(playerLookTarget) > 0.001) this.mesh.lookAt(playerLookTarget);
            const now = performance.now();
            if (now - this.lastShotTime > 1200) { this.shootAtPlayer(playerPos); this.lastShotTime = now; }
        }
    }
    shootAtPlayer(playerPos) {
        playGunshotSound('mp5');
        createLaserBeam(this.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), playerPos, 0xf97316);
        if (Math.random() < 0.3) damagePlayer(12, this);
    }
    takeDamage(amount, isHeadshot = false, hitPoint = null) {
        this.health -= amount;
        if (isHeadshot) playHeadshotSound(); else playHitmarkerSound();
        showHitmarker(isHeadshot);
        if (hitPoint) showDamagePopup(amount, hitPoint, isHeadshot);
        if (this.health <= 0) {
            this.respawn(); this.deaths++; playerScore += isHeadshot ? 150 : 100;
            teamScorePhantoms += 10; killCount++;
            document.getElementById('score-phantoms').innerText = teamScorePhantoms;
            updateKDDisplay();
            const points = isHeadshot ? "+150 HEADSHOT ELIMINATION (+50 BONUS)" : "+100 ENEMY KILLED";
            showKillNotification(points);
            addKillFeedEntry(isHeadshot ? `PHANTOM-1 [HEADSHOT] ${this.name}` : `PHANTOM-1 eliminated [GHOST] ${this.name}`);
        }
    }
    respawn() { this.health = 100; this.mesh.position.copy(this.getRandomTarget()); }
}

const bots = [];
const botNames = ['GHOST-ALPHA', 'GHOST-BRAVO', 'GHOST-CHARLIE', 'GHOST-DELTA'];
botNames.forEach((name, i) => bots.push(new Bot(name, new THREE.Vector3((i - 1.5) * 20, 0, -30))));

let teamScorePhantoms = 150; let teamScoreGhosts = 135; let playerScore = 0;
let lastAttacker = null; let isADS = false; let adsStartTime = 0;
const SNIPER_SCOPE_DELAY_MS = 150;
let isSprinting = false; let playerStance = 'STAND';
let health = 100; let isReloading = false; let isDead = false;
let respawnInterval = null; let lastShotTime = 0; let killCount = 0; let deathCount = 0;

function getMaxClip() {
    const magMod = (ATTACHMENTS.mag[currentLoadout.mag] && ATTACHMENTS.mag[currentLoadout.mag].clipMod) || 1.0;
    return Math.round(currentWeapon.maxClip * magMod);
}

function updateLoadoutUI() {
    const weapon = WEAPONS[currentWeaponKey];
    const opticEl = document.getElementById('optic-select'); if (opticEl) opticEl.value = currentLoadout.scope;
    const muzzleEl = document.getElementById('muzzle-select'); if (muzzleEl) muzzleEl.value = currentLoadout.muzzle;
    const stockEl = document.getElementById('stock-select'); if (stockEl) stockEl.value = currentLoadout.stock;
    const magEl = document.getElementById('mag-select'); if (magEl) magEl.value = currentLoadout.mag;
    const handleEl = document.getElementById('handle-select'); if (handleEl) handleEl.value = currentLoadout.handle;

    const baseRecoilScore = currentWeaponKey === 'AWP' ? 28 : (currentWeaponKey === 'mp5' ? 76 : 64);
    const muzzle = ATTACHMENTS.muzzle[currentLoadout.muzzle] || ATTACHMENTS.muzzle.none;
    const stock = ATTACHMENTS.stock[currentLoadout.stock] || ATTACHMENTS.stock.standard;
    const handle = ATTACHMENTS.handle[currentLoadout.handle] || ATTACHMENTS.handle.none;
    const totalClimbMod = (muzzle.recoilClimbMod || 1.0) * (stock.recoilClimbMod || 1.0) * (handle.recoilClimbMod || 1.0);
    const totalKickHMod = (muzzle.recoilKickHMod || 1.0) * (handle.recoilKickHMod || 1.0);
    const scopeRecoilMod = (ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron).recoilMod || 1.0;
    const avgMod = ((totalClimbMod * scopeRecoilMod) + (totalKickHMod * scopeRecoilMod)) / 2;
    const recoilScore = Math.min(98, Math.max(15, Math.round(baseRecoilScore / avgMod)));

    document.getElementById('ammo-clip').innerText = ammoClip;
    document.getElementById('weapon-name-hud').innerText = weapon.name;
    document.getElementById('ammo-reserve').innerText = ammoReserve;
    document.getElementById('firemode-hud').innerText = currentWeaponKey === 'AWP' ? 'BOLT' : 'AUTO';
}

function switchWeapon(weaponKey) {
    if (!WEAPONS[weaponKey]) return;
    if (isReloading || weaponKey === currentWeaponKey) return;
    currentWeaponKey = weaponKey;
    currentWeapon = WEAPONS[currentWeaponKey];
    currentLoadout = loadouts[currentWeaponKey]; // Switch to this gun's specific loadout
    ammoClip = getMaxClip(); ammoReserve = currentWeapon.reserve;
    rebuildWeaponMesh();
    isADS = false; gunGroup.visible = true;
    document.getElementById('sniper-scope').style.opacity = '0';
    updateLoadoutUI();
    updateLoadoutViewer();
    
    document.querySelectorAll('.weapon-select-btn').forEach(b => {
        if (b.getAttribute('data-weapon') === weaponKey) b.classList.add('active');
        else b.classList.remove('active');
    });
}

function startReload() {
    const maxClip = getMaxClip(); isReloading = true; isADS = false;
    gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0';
    document.getElementById('ammo-clip').innerText = 'RLD...';
    const reloadMs = playReloadAnimation();   // 1400ms fallback for weapons without an animation
    setTimeout(() => {
        const needed = maxClip - ammoClip; const added = Math.min(needed, ammoReserve);
        ammoClip += added; ammoReserve -= added;
        document.getElementById('ammo-clip').innerText = ammoClip;
        document.getElementById('ammo-reserve').innerText = ammoReserve;
        isReloading = false;
    }, reloadMs);
}
function triggerAutoReload() { if (ammoClip <= 0 && ammoReserve > 0 && !isReloading) startReload(); }

const moveState = { forward: false, backward: false, left: false, right: false };
const velocity = new THREE.Vector3(); const direction = new THREE.Vector3();
let canJump = false; let isGrounded = true;
const clock = new THREE.Clock(); const raycaster = new THREE.Raycaster();

let recoilPendingPitch = 0; let recoilPendingYaw = 0;
let recoilPitchVel = 0; let recoilYawVel = 0;          // camera speed while chasing the pending recoil (gives the ease in / ease out)
let recoilAccumPitch = 0;
let recoverActive = false; let recoverStart = 0; let recoverTotal = 0; let recoverApplied = 0;
let recoilHDrift = 0; let lastRecoilShotTime = 0;
const RECOIL_SMOOTH = 9;           // how fast the camera chases the pending recoil
const RECOIL_ACCEL = 14;           // how fast the climb speed ramps up / down. Lower = softer, more gradual S-curve
const RECOIL_RECOVER_FRAC = 0.4;   // fraction of the climb that comes back down after you stop firing
const RECOIL_RECOVER_DELAY_MS = 150;
const RECOIL_RECOVER_MS = 520;     // length of the eased drop back down
const SPRINT_FIRE_DELAY_MS = 180; let sprintFireReadyAt = 0;
let sprintCancelledByFire = false; let shiftHeld = false;
let queuedShot = false; let lastHorizSpeed = 0;
let recoilGunKickZ = 0; let recoilGunRotX = 0; let recoilGunRotY = 0; let recoilGunRotZ = 0;
let continuousShots = 0; let crosshairSpread = 0;
let mouseSwayX = 0; let mouseSwayY = 0; let targetMouseSwayX = 0; let targetMouseSwayY = 0;
let walkTime = 0; let landingDip = 0; let cameraRoll = 0;

function updateCrosshairVisuals() {
    const top = document.getElementById('ch-top'); const bottom = document.getElementById('ch-bottom');
    const left = document.getElementById('ch-left'); const right = document.getElementById('ch-right');
    const offset = 8 + crosshairSpread * 0.8;
    if (top) top.style.transform = `translate(-50%, -${offset}px)`;
    if (bottom) bottom.style.transform = `translate(-50%, ${offset}px)`;
    if (left) left.style.transform = `translate(-${offset}px, -50%)`;
    if (right) right.style.transform = `translate(${offset}px, -50%)`;
}

function createLaserBeam(from, to, colorHex = 0x38bdf8) {
    const distance = from.distanceTo(to); if (distance < 0.01) return;
    const geom = new THREE.CylinderGeometry(0.02, 0.02, distance, 6);
    geom.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const laser = new THREE.Mesh(geom, mat);
    laser.position.copy(from).add(to).multiplyScalar(0.5); laser.lookAt(to);
    scene.add(laser);
    setTimeout(() => { scene.remove(laser); geom.dispose(); mat.dispose(); }, 50);
}

/* --- Bullet tracers: a visible bullet with a fading trail that travels from the barrel to the target --- */
const TRACER_SPEED = 180;     // world units per second (lower = easier to see the bullet fly)
const TRACER_TRAIL = 3.5;     // maximum trail length behind the bullet
const TRACER_HEAD = 0.5;      // length of the bright bullet slug
const tracers = [];
let _tracerGeo = null; let _tracerHeadMat = null; const _tracerTrailMats = {};

function getTracerAssets(colorHex) {
    if (!_tracerGeo) {
        // Both meshes run along Z, from z = -1 (tail) to z = 0 (front); the group is aimed so +Z points at the target
        const trail = new THREE.CylinderGeometry(0.014, 0.014, 1, 6, 1, true); trail.rotateX(Math.PI / 2); trail.translate(0, 0, -0.5);
        const head = new THREE.CylinderGeometry(0.022, 0.022, 1, 8); head.rotateX(Math.PI / 2); head.translate(0, 0, -0.5);
        _tracerGeo = { trail, head };
        _tracerHeadMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    }
    if (!_tracerTrailMats[colorHex]) {
        _tracerTrailMats[colorHex] = new THREE.ShaderMaterial({
            uniforms: { color: { value: new THREE.Color(colorHex) } },
            vertexShader: 'varying float vA; void main() { vA = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform vec3 color; varying float vA; void main() { float a = pow(clamp(vA, 0.0, 1.0), 2.0); gl_FragColor = vec4(color * (0.7 + a), a); }',
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
    }
    return { geo: _tracerGeo, headMat: _tracerHeadMat, trailMat: _tracerTrailMats[colorHex] };
}

function spawnTracer(from, to, colorHex = 0xffd27a) {
    const total = from.distanceTo(to); if (total < 0.05) return;
    const a = getTracerAssets(colorHex);
    const group = new THREE.Group();
    const trail = new THREE.Mesh(a.geo.trail, a.trailMat); trail.frustumCulled = false;
    const head = new THREE.Mesh(a.geo.head, a.headMat); head.frustumCulled = false;
    group.add(trail, head);
    group.position.copy(from); group.lookAt(to);
    group.visible = false;               // shown on the first update, once it has a length
    scene.add(group);
    tracers.push({ group, trail, head, from: from.clone(), dir: to.clone().sub(from).normalize(), total, age: 0 });
}

function updateTracers(delta) {
    for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i];
        t.age += delta;
        const travelled = TRACER_SPEED * t.age;
        const headDist = Math.min(travelled, t.total);                       // bullet stops at the impact point
        const tailDist = Math.min(Math.max(0, travelled - TRACER_TRAIL), t.total);
        if (tailDist >= t.total) { scene.remove(t.group); tracers.splice(i, 1); continue; }
        t.group.visible = true;
        t.group.position.copy(t.from).addScaledVector(t.dir, headDist);
        t.trail.scale.z = Math.max(0.001, headDist - tailDist);
        t.head.visible = travelled <= t.total;                               // slug disappears on impact, the trail drains out
        t.head.scale.z = Math.max(0.001, Math.min(TRACER_HEAD, headDist));
    }
}

// Barrel tip in world space (falls back to the gun origin for meshes without a muzzle marker)
function getMuzzleWorldPos() {
    const out = new THREE.Vector3();
    const ud = customGunMesh && customGunMesh.userData;
    if (ud && ud.muzzleZ != null) {
        customGunMesh.updateWorldMatrix(true, false);
        return customGunMesh.localToWorld(out.set(0, ud.muzzleY ?? 0.02, ud.muzzleZ));
    }
    return gunGroup.getWorldPosition(out);
}

function showHitmarker(isHeadshot = false) {
    const hm = document.getElementById('hitmarker');
    if (hm) {
        const lines = hm.querySelectorAll('.hitmark-line');
        lines.forEach(l => { l.style.backgroundColor = isHeadshot ? '#ef4444' : '#ffffff'; l.style.boxShadow = isHeadshot ? '0 0 8px #ef4444' : '0 0 4px #ffffff'; });
        hm.style.transform = isHeadshot ? 'translate(-50%, -50%) rotate(45deg) scale(1.35)' : 'translate(-50%, -50%) rotate(45deg) scale(1.0)';
        hm.style.opacity = '1';
        setTimeout(() => { hm.style.opacity = '0'; hm.style.transform = 'translate(-50%, -50%) rotate(45deg) scale(1.0)'; }, 130);
    }
}

function showKillNotification(txt) {
    const el = document.getElementById('kill-notify');
    if (el) { el.innerText = txt; el.style.opacity = '1'; setTimeout(() => el.style.opacity = '0', 1800); }
}

function showDamagePopup(amt, worldPos, isHeadshot = false) {
    const screenPos = worldPos.clone().project(camera);
    if (screenPos.z > 1) return;
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;
    const popup = document.createElement('div'); popup.className = 'damage-popup';
    if (isHeadshot) { popup.innerText = `CRIT -${amt}`; popup.style.color = '#ef4444'; popup.style.fontSize = '32px'; }
    else { popup.innerText = `-${amt}`; popup.style.color = '#fbbf24'; }
    popup.style.left = `${x}px`; popup.style.top = `${y}px`;
    document.getElementById('popups-container').appendChild(popup);
    setTimeout(() => popup.remove(), 800);
}

function shoot() {
    if (ammoClip <= 0 || isReloading || isDead) return;
    const now = performance.now();
    if (isSprinting && lastHorizSpeed > 2) {
        isSprinting = false; sprintCancelledByFire = true; sprintFireReadyAt = now + SPRINT_FIRE_DELAY_MS;
    }
    if (now < sprintFireReadyAt) return;
    const fireInterval = 60000 / currentWeapon.fireRate;
    if (now - lastShotTime < fireInterval) return;
    lastShotTime = now; ammoClip--;
    document.getElementById('ammo-clip').innerText = ammoClip;
    if (ammoClip <= 0) setTimeout(() => triggerAutoReload(), 300);
    playGunshotSound(currentWeaponKey);
    ejectShell();

    const muzzle = ATTACHMENTS.muzzle[currentLoadout.muzzle] || ATTACHMENTS.muzzle.none;
    const stock = ATTACHMENTS.stock[currentLoadout.stock] || ATTACHMENTS.stock.standard;
    const handle = ATTACHMENTS.handle[currentLoadout.handle] || ATTACHMENTS.handle.none;
    const totalClimbMod = (muzzle.recoilClimbMod || 1.0) * (stock.recoilClimbMod || 1.0) * (handle.recoilClimbMod || 1.0);
    const totalKickHMod = (muzzle.recoilKickHMod || 1.0) * (handle.recoilKickHMod || 1.0);

    continuousShots++;
    const sprayFactor = Math.min(1.7, 1.0 + (continuousShots * 0.03));
    const stanceMultiplier = playerStance === 'CROUCH' ? 0.72 : (playerStance === 'PRONE' ? 0.50 : 1.0);
    const adsMultiplier = isADS ? 0.75 : 1.0;
    const scopeRecoil = (ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron).recoilMod || 1.0;
    const climb = currentWeapon.recoilClimb * totalClimbMod * sprayFactor * stanceMultiplier * adsMultiplier * scopeRecoil;

    recoilHDrift = Math.max(-1, Math.min(1, recoilHDrift + (Math.random() - 0.5) * 0.5));
    const horiz = (recoilHDrift * 0.6 + (Math.random() - 0.5) * 0.3 + 0.04) * currentWeapon.recoilKickH * totalKickHMod * sprayFactor * stanceMultiplier * scopeRecoil;

    recoilPendingPitch += climb * 0.8; recoilPendingYaw += horiz * 0.7;
    recoilAccumPitch += climb * 0.8; recoverActive = false; lastRecoilShotTime = now;

    recoilGunKickZ = Math.min(0.35, recoilGunKickZ + currentWeapon.gunKickZ * scopeRecoil);
    recoilGunRotX = Math.min(0.65, recoilGunRotX + currentWeapon.gunRotX * totalClimbMod * scopeRecoil);
    recoilGunRotZ += (Math.random() - 0.5) * 0.03; recoilGunRotY += (Math.random() - 0.5) * 0.015;

    crosshairSpread = Math.min(38, crosshairSpread + (currentWeaponKey === 'AWP' ? 26 : 7) * totalClimbMod);

    const isSniperOverlay = ATTACHMENTS.scope[currentLoadout.scope]?.useSniperOverlay;
    if (isADS && isSniperOverlay) {
        const scopeEl = document.getElementById('sniper-scope');
        if (scopeEl) {
            scopeEl.style.transform = `scale(1.08) translate(${(Math.random() - 0.5) * 24}px, -32px)`;
            setTimeout(() => { scopeEl.style.transform = 'scale(1) translate(0, 0)'; }, 130);
        }
    }

    const spreadRad = (crosshairSpread * 0.0008) * (isADS ? 0.15 : 1.0);
    const spreadOffsetX = (Math.random() - 0.5) * spreadRad;
    const spreadOffsetY = (Math.random() - 0.5) * spreadRad;
    raycaster.setFromCamera(new THREE.Vector2(spreadOffsetX, spreadOffsetY), camera);
    const botMeshes = bots.map(b => b.mesh);
    const intersects = raycaster.intersectObjects([...collidableObjects, ...botMeshes], true);
    const muzzlePos = getMuzzleWorldPos();

    if (intersects.length > 0) {
        const hit = intersects[0];
        spawnTracer(muzzlePos, hit.point, currentWeapon.color);
        let hitBot = null; let isHeadshot = false;
        bots.forEach(b => { b.mesh.traverse(child => { if (child === hit.object) { hitBot = b; if (child.userData && child.userData.isHead) isHeadshot = true; } }); });
        if (hitBot) {
            const hitHeight = hit.point.y - hitBot.mesh.position.y;
            if (hitHeight >= 1.32) isHeadshot = true;
            const baseDmg = currentWeapon.damage; const dmg = isHeadshot ? Math.round(baseDmg * 2.2) : baseDmg;
            hitBot.takeDamage(dmg, isHeadshot, hit.point);
        }
    } else {
        const farPoint = new THREE.Vector3(); raycaster.ray.at(120, farPoint);
        spawnTracer(muzzlePos, farPoint, currentWeapon.color);
    }
}

function damagePlayer(amount, source = null) {
    if (isDead) return;
    if (source) lastAttacker = source;
    health = Math.max(0, health - amount);
    document.getElementById('hp-bar').style.width = `${health}%`;
    document.getElementById('hp-text').innerText = `${health} HP`;
    const flash = document.getElementById('hit-flash');
    flash.style.backgroundColor = 'rgba(239, 68, 68, 0.35)';
    setTimeout(() => flash.style.backgroundColor = 'rgba(239, 68, 68, 0)', 100);
    if (health <= 0 && !isDead) {
        isDead = true; deathCount++;
        if (lastAttacker) {
            lastAttacker.kills++; lastAttacker.score += 100; teamScoreGhosts += 10;
            const gs = document.getElementById('score-ghosts'); if (gs) gs.innerText = teamScoreGhosts;
            addKillFeedEntry(`[GHOST] ${lastAttacker.name} eliminated PHANTOM-1`); lastAttacker = null;
        }
        updateKDDisplay(); controls.unlock();
        document.getElementById('respawn-screen').classList.remove('hidden');
        let timeLeft = 5; const timerEl = document.getElementById('respawn-timer');
        const deployBtn = document.getElementById('respawn-deploy-btn');
        timerEl.innerText = timeLeft; deployBtn.disabled = true;
        deployBtn.className = "menu-btn"; deployBtn.innerText = `DEPLOYING IN ${timeLeft}s`;
        if (respawnInterval) clearInterval(respawnInterval);
        respawnInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) { timerEl.innerText = timeLeft; deployBtn.innerText = `DEPLOYING IN ${timeLeft}s`; }
            else {
                clearInterval(respawnInterval); timerEl.innerText = '0'; deployBtn.disabled = false;
                deployBtn.innerText = "DEPLOY NOW";
            }
        }, 1000);
        addKillFeedEntry('PHANTOM-1 KIA - Awaiting Respawn Cooldown');
    }
}

function triggerRespawn() {
    isDead = false; health = 100; ammoClip = getMaxClip(); ammoReserve = currentWeapon.reserve;
    document.getElementById('hp-bar').style.width = '100%'; document.getElementById('hp-text').innerText = '100 HP';
    document.getElementById('ammo-clip').innerText = ammoClip; document.getElementById('ammo-reserve').innerText = ammoReserve;
    controls.getObject().position.set(0, 1.6, 40);
    isADS = false; gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0';
    document.getElementById('respawn-screen').classList.add('hidden');
    controls.lock(); addKillFeedEntry('PHANTOM-1 redeployed to combat zone');
}

document.getElementById('respawn-deploy-btn').addEventListener('click', () => {
    const btn = document.getElementById('respawn-deploy-btn'); if (!btn.disabled) triggerRespawn();
});

function addKillFeedEntry(msg) {
    const feed = document.getElementById('kill-feed'); const entry = document.createElement('div');
    entry.innerText = msg; feed.appendChild(entry); setTimeout(() => entry.remove(), 4000);
}
function updateKDDisplay() { const el = document.getElementById('kd-display'); if (el) el.innerText = `${killCount} / ${deathCount}`; }

/* --- UI Event Listeners --- */
['optic-select', 'muzzle-select', 'stock-select', 'mag-select', 'handle-select'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('change', (e) => {
        const val = e.target.value;
        // The dropdown is 'optic-select' but the loadout stores it under 'scope'
        const part = id === 'optic-select' ? 'scope' : id.replace('-select', '');
        currentLoadout[part] = val; // Updates loadouts[currentWeaponKey][part]
        rebuildWeaponMesh(); updateLoadoutUI(); updateLoadoutViewer();
    });
});

document.querySelectorAll('.weapon-select-btn').forEach(btn => {
    btn.addEventListener('click', (e) => switchWeapon(e.currentTarget.getAttribute('data-weapon')));
});

/* Navigation Buttons */
document.getElementById('btn-play').addEventListener('click', () => controls.lock());
document.getElementById('btn-loadout').addEventListener('click', () => {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('loadout-screen').classList.remove('hidden');
    updateLoadoutViewer();
});
document.getElementById('btn-settings-menu').addEventListener('click', () => {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('settings-screen').classList.remove('hidden');
});
document.getElementById('btn-back-loadout').addEventListener('click', () => {
    document.getElementById('loadout-screen').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
});
document.getElementById('btn-back-settings').addEventListener('click', () => {
    document.getElementById('settings-screen').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
});

/* Settings Logic */
document.getElementById('setting-fov').addEventListener('input', (e) => {
    const val = parseInt(e.target.value); gameSettings.fov = val;
    document.getElementById('val-setting-fov').innerText = `${val}°`;
    camera.fov = val; camera.updateProjectionMatrix(); saveSettings();
});
document.getElementById('setting-volume').addEventListener('input', (e) => {
    const val = parseInt(e.target.value); setMasterVolume(val / 100);
    document.getElementById('val-setting-volume').innerText = `${val}%`; saveSettings();
});
document.getElementById('setting-sens').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value); gameSettings.sensitivity = val;
    document.getElementById('val-setting-sens').innerText = `${val.toFixed(2)}x`; saveSettings();
});

window.addEventListener('keydown', (e) => {
    if (isDead) {
        if (e.code === 'Space' || e.code === 'Enter') { const btn = document.getElementById('respawn-deploy-btn'); if (btn && !btn.disabled) triggerRespawn(); }
        return;
    }
    if (!controls.isLocked) return;
    if (e.code === 'Digit1') { switchWeapon('m4a1'); return; }
    if (e.code === 'Digit2') { switchWeapon('AWP'); return; }
    if (e.code === 'Digit3') { switchWeapon('mp5'); return; }
    switch (e.code) {
        case 'KeyW': moveState.forward = true; break;
        case 'KeyS': moveState.backward = true; break;
        case 'KeyA': moveState.left = true; break;
        case 'KeyD': moveState.right = true; break;
        case 'ShiftLeft':
            shiftHeld = true; sprintCancelledByFire = false;
            if (playerStance === 'STAND') { isSprinting = true; isADS = false; gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0'; }
            break;
        case 'KeyC': case 'ControlLeft':
            if (!isGrounded) break; playerStance = playerStance === 'CROUCH' ? 'STAND' : 'CROUCH';
            if (playerStance !== 'STAND') isSprinting = false;
            document.getElementById('stance-indicator').innerText = playerStance; break;
        case 'KeyZ':
            if (!isGrounded) break; playerStance = playerStance === 'PRONE' ? 'STAND' : 'PRONE';
            if (playerStance !== 'STAND') isSprinting = false;
            document.getElementById('stance-indicator').innerText = playerStance; break;
        case 'Space':
            if (canJump && isGrounded) {
                const playerObj = controls.getObject();
                if (playerStance !== 'STAND') {
                    const curEyeH = playerStance === 'CROUCH' ? 1.0 : 0.4; playerObj.position.y += (1.6 - curEyeH);
                    playerStance = 'STAND'; document.getElementById('stance-indicator').innerText = 'STAND';
                }
                velocity.y = (isSprinting ? 12.5 : 11.0); canJump = false; isGrounded = false; landingDip = -0.12;
            } break;
        case 'KeyR':
            const maxClip = getMaxClip();
            if (ammoClip < maxClip && ammoReserve > 0 && !isReloading) startReload(); break;
    }
});
window.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW': moveState.forward = false; break;
        case 'KeyS': moveState.backward = false; break;
        case 'KeyA': moveState.left = false; break;
        case 'KeyD': moveState.right = false; break;
        case 'ShiftLeft': isSprinting = false; shiftHeld = false; sprintCancelledByFire = false; break;
    }
});
window.addEventListener('mousedown', (e) => {
    if (!controls.isLocked) return;
    if (e.button === 0) { window.isMouseDown = true; shoot(); if (currentWeaponKey === 'AWP' && performance.now() < sprintFireReadyAt) queuedShot = true; }
    if (e.button === 2) {
        isADS = true; const scopeConfig = ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron;
        adsStartTime = performance.now();
        if (scopeConfig.useSniperOverlay) { document.getElementById('sniper-scope').style.opacity = '0'; gunGroup.visible = true; }
        else { document.getElementById('sniper-scope').style.opacity = '0'; gunGroup.visible = true; }
    }
});
window.addEventListener('mouseup', (e) => {
    if (e.button === 0) window.isMouseDown = false;
    if (e.button === 2) { isADS = false; document.getElementById('sniper-scope').style.opacity = '0'; gunGroup.visible = true; }
});
window.addEventListener('blur', () => {
    window.isMouseDown = false; shiftHeld = false; sprintCancelledByFire = false; queuedShot = false;
    moveState.forward = false; moveState.backward = false; moveState.left = false; moveState.right = false; isSprinting = false;
});
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeLoadoutViewer();
});

/* --- Loadout 3D Viewer --- */
const loadoutScene = new THREE.Scene();
loadoutScene.background = new THREE.Color(0x0f172a);
const loadoutCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
loadoutCamera.position.set(0, 0.2, 1.2); loadoutCamera.lookAt(0, 0, 0);

const loadoutRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
loadoutRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('loadout-viewer').appendChild(loadoutRenderer.domElement);

const loadoutLight = new THREE.DirectionalLight(0xffffff, 1.5);
loadoutLight.position.set(2, 5, 3); loadoutScene.add(loadoutLight);
loadoutScene.add(new THREE.AmbientLight(0xffffff, 0.8));

let loadoutGunGroup = new THREE.Group(); loadoutScene.add(loadoutGunGroup);

// Debug tune panel state (declared up here so the viewer functions below can use it)
let loadoutGun = null;          // gun mesh currently shown in the viewer
let loadoutAxes = null;         // axes helper attached to the optic
let tunePanel = null;
const loadoutTune = { preview: 'hip', axes: false, showAll: false };

function resizeLoadoutViewer() {
    const container = document.getElementById('loadout-viewer');
    if (container) {
        const w = container.clientWidth; const h = container.clientHeight;
        loadoutRenderer.setSize(w, h); loadoutCamera.aspect = w / h; loadoutCamera.updateProjectionMatrix();
    }
}

/* View controls: drag = rotate, Shift+drag or right-drag = move, wheel = zoom, double-click = reset */
const LOADOUT_VIEW_DEFAULT = { yaw: -Math.PI / 4, pitch: 0.1, panX: 0, panY: 0, zoom: 1 };
const loadoutView = { ...LOADOUT_VIEW_DEFAULT };
let loadoutAutoRotate = true;      // spins slowly until you touch it; double-click resets and re-enables
let loadoutDrag = null;
loadoutGunGroup.rotation.order = 'YXZ';

function applyLoadoutView() {
    loadoutGunGroup.rotation.set(loadoutView.pitch, loadoutView.yaw, 0);
    loadoutGunGroup.position.set(loadoutView.panX, loadoutView.panY, 0);
    loadoutGunGroup.scale.setScalar(loadoutView.zoom);
}

(function initLoadoutViewerControls() {
    const el = loadoutRenderer.domElement;
    el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        loadoutDrag = { x: e.clientX, y: e.clientY, mode: (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate' };
        loadoutAutoRotate = false;
    });
    el.addEventListener('pointermove', (e) => {
        if (!loadoutDrag) return;
        const dx = e.clientX - loadoutDrag.x, dy = e.clientY - loadoutDrag.y;
        loadoutDrag.x = e.clientX; loadoutDrag.y = e.clientY;
        if (loadoutDrag.mode === 'pan') {
            // convert pixels to world units at the camera distance
            const h = 2 * loadoutCamera.position.z * Math.tan(THREE.MathUtils.degToRad(loadoutCamera.fov / 2));
            const k = h / Math.max(1, el.clientHeight);
            loadoutView.panX += dx * k; loadoutView.panY -= dy * k;
        } else {
            loadoutView.yaw += dx * 0.01;
            loadoutView.pitch = Math.max(-1.2, Math.min(1.2, loadoutView.pitch + dy * 0.01));
        }
    });
    const endDrag = () => { loadoutDrag = null; };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        loadoutAutoRotate = false;
        loadoutView.zoom = Math.max(0.4, Math.min(3, loadoutView.zoom * Math.exp(-e.deltaY * 0.001)));
    }, { passive: false });
    el.addEventListener('dblclick', () => { Object.assign(loadoutView, LOADOUT_VIEW_DEFAULT); loadoutAutoRotate = true; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
})();

function updateLoadoutViewer() {
    loadoutGunGroup.clear();
    loadoutGunGroup.rotation.set(0, 0, 0); loadoutGunGroup.position.set(0, 0, 0); loadoutGunGroup.scale.setScalar(1);
    const savedAnim = weaponAnim;   // building a gun overwrites the global weaponAnim; keep the held gun's
    const tempGun = createProceduralWeapon(currentWeaponKey, currentLoadout);
    weaponAnim = savedAnim;
    tempGun.position.set(0, 0, 0); tempGun.rotation.set(0, 0, 0); tempGun.scale.setScalar(1);
    loadoutGunGroup.add(tempGun);
    loadoutGun = tempGun;
    loadoutGunGroup.updateMatrixWorld(true);

    // Fit the gun to a fixed size and put its centre exactly at the pivot (the group's origin),
    // so rotating / moving / zooming the group behaves around the middle of the gun.
    const box = new THREE.Box3().setFromObject(tempGun);
    const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    const fit = 0.8 / Math.max(size.x, size.y, size.z, 0.0001);
    tempGun.scale.setScalar(fit);
    tempGun.position.copy(center).multiplyScalar(-fit);

    applyLoadoutView();
    resizeLoadoutViewer();
    applyViewerScopeTune(); applyTuneAxes(); refreshTunePanel();
}

function animateLoadoutViewer() {
    requestAnimationFrame(animateLoadoutViewer);
    if (!document.getElementById('loadout-screen').classList.contains('hidden')) {
        if (loadoutAutoRotate && !loadoutDrag) loadoutView.yaw += 0.005;
        applyLoadoutView();
        applyViewerScopeTune();   // keeps the scope on the SCOPE_TUNE / SCOPE_ADS_TUNE coordinates (live while you edit)
        loadoutRenderer.render(loadoutScene, loadoutCamera);
    }
}
animateLoadoutViewer();

/* ======================================================================
   LOADOUT TUNE PANEL (debug) - edit scope / gun coordinates in the selection screen.
   Edits go straight into SCOPE_TUNE / SCOPE_ADS_TUNE / ADS_TUNE (gunsLoad.js), so they also
   apply in-game right away. Use COPY to paste the numbers back into gunsLoad.js.
   ====================================================================== */
const TUNE_DEFAULTS = JSON.parse(JSON.stringify({ hip: SCOPE_TUNE, ads: SCOPE_ADS_TUNE, gun: ADS_TUNE }));
const TUNE_AXES = [['x', -0.3, 0.3], ['y', -0.3, 0.3], ['z', -0.6, 0.6]];
const TUNE_GROUPS = [
    ['hip', 'SCOPE - HIP / RESTING', 'SCOPE_TUNE'],
    ['ads', 'SCOPE - ADS (AIMING)', 'SCOPE_ADS_TUNE'],
    ['gun', 'GUN - ADS POSE', 'ADS_TUNE'],
];
const tuneTable = (g) => g === 'hip' ? SCOPE_TUNE : g === 'ads' ? SCOPE_ADS_TUNE : ADS_TUNE;
const f4 = (v) => +(+v).toFixed(4) + 0;

function tuneVals(g) {
    const k = adsTuneKey();
    if (g === 'gun') {
        if (ADS_TUNE[k]) return ADS_TUNE[k];
        const ud = (loadoutGun && loadoutGun.userData) || {};
        return { x: ud.adsX ?? 0, y: ud.adsAimY ?? 0.1, z: ud.adsZ ?? -0.25 };
    }
    const hip = SCOPE_TUNE[k] || { x: 0, y: 0.055, z: 0 };            // same fallbacks as applyScopeTune()
    if (g === 'hip') return hip;
    return SCOPE_ADS_TUNE[k] || { x: hip.x, y: hip.y, z: hip.z };
}
function tuneSet(g, axis, v) {
    const k = adsTuneKey(); const t = tuneTable(g);
    if (!t[k]) t[k] = { ...tuneVals(g) };
    t[k][axis] = v;
}
function tuneOptic() { return loadoutGun ? loadoutGun.getObjectByName('optic') : null; }
function tuneHasOptic() {
    const o = tuneOptic();
    return !!(currentLoadout.scope && currentLoadout.scope !== 'iron' && o && o.children.length > 0);
}

// Places the viewer's scope the same way applyScopeTune() does in-game
function applyViewerScopeTune() {
    const o = tuneOptic(); if (!o) return;
    const v = tuneVals(loadoutTune.preview);
    o.position.set(v.x, v.y, v.z);
}
function applyTuneAxes() {
    if (loadoutAxes && loadoutAxes.parent) loadoutAxes.parent.remove(loadoutAxes);
    const o = tuneOptic();
    if (!loadoutTune.axes || !o) return;
    if (!loadoutAxes) {
        loadoutAxes = new THREE.AxesHelper(0.15);            // red = X, green = Y, blue = Z
        loadoutAxes.material.depthTest = false; loadoutAxes.renderOrder = 999;
    }
    o.add(loadoutAxes);
}

function tuneSnippet() {
    const k = adsTuneKey();
    const line = (g) => { const v = tuneVals(g); return `'${k}': { x: ${f4(v.x)}, y: ${f4(v.y)}, z: ${f4(v.z)} },`; };
    return (tuneHasOptic() ? `// SCOPE_TUNE (hip)\n${line('hip')}\n// SCOPE_ADS_TUNE (ads)\n${line('ads')}\n` : '') + `// ADS_TUNE (gun pose)\n${line('gun')}`;
}
function tuneAllSnippet() {
    const blk = (name, t) => `const ${name} = {\n` + Object.keys(t).map(k => `\t'${k}': { x: ${f4(t[k].x)}, y: ${f4(t[k].y)}, z: ${f4(t[k].z)} },`).join('\n') + '\n};';
    return [blk('ADS_TUNE', ADS_TUNE), blk('SCOPE_TUNE', SCOPE_TUNE), blk('SCOPE_ADS_TUNE', SCOPE_ADS_TUNE)].join('\n\n');
}

function refreshTunePanel() {
    if (!tunePanel) return;
    document.getElementById('tune-key').innerText = adsTuneKey();
    const hasOptic = tuneHasOptic();
    document.getElementById('tune-note').innerText = hasOptic ? 'Axes helper: red X, green Y, blue Z.'
        : 'No separate optic model (iron sights / built-in scope): scope tuning is off for this loadout.';
    tunePanel.querySelectorAll('.tune-group').forEach((grp) => {
        const g = grp.dataset.group; const off = g !== 'gun' && !hasOptic;
        grp.classList.toggle('off', off);
        const v = tuneVals(g);
        grp.querySelectorAll('input').forEach((inp) => {
            inp.disabled = off;
            if (inp === document.activeElement) return;            // don't fight the control being edited
            inp.value = inp.type === 'number' ? f4(v[inp.dataset.a]) : v[inp.dataset.a];
        });
    });
    tunePanel.querySelectorAll('input[name="tune-prev"]').forEach(r => { r.checked = r.value === loadoutTune.preview; r.disabled = !hasOptic; });
    document.getElementById('tune-axes').checked = loadoutTune.axes;
    document.getElementById('tune-out').value = loadoutTune.showAll ? tuneAllSnippet() : tuneSnippet();
}

(function initTunePanel() {
    const host = document.querySelector('.loadout-right');
    if (!host) return;
    const toggle = document.createElement('button');
    toggle.id = 'tune-toggle'; toggle.textContent = 'TUNE';
    tunePanel = document.createElement('div');
    tunePanel.id = 'tune-panel'; tunePanel.className = 'hidden';
    const rows = TUNE_GROUPS.map(([g, title, tbl]) =>
        `<div class="tune-group" data-group="${g}"><div class="tune-title">${title}<span class="tune-tbl">${tbl}</span></div>` +
        TUNE_AXES.map(([a, mn, mx]) =>
            `<div class="tune-row"><label>${a.toUpperCase()}</label>` +
            `<input type="range" data-g="${g}" data-a="${a}" min="${mn}" max="${mx}" step="0.0005">` +
            `<input type="number" data-g="${g}" data-a="${a}" step="0.001"></div>`).join('') + `</div>`).join('');
    tunePanel.innerHTML =
        `<div class="tune-head"><b>TUNE DEBUG</b><span id="tune-key"></span></div><div id="tune-note"></div>` + rows +
        `<div class="tune-opts"><label><input type="radio" name="tune-prev" value="hip"> preview hip</label>` +
        `<label><input type="radio" name="tune-prev" value="ads"> preview ADS</label>` +
        `<label><input type="checkbox" id="tune-axes"> axes</label></div>` +
        `<textarea id="tune-out" readonly rows="7" spellcheck="false"></textarea>` +
        `<div class="tune-btns"><button id="tune-copy">COPY THIS</button><button id="tune-copy-all">COPY ALL</button><button id="tune-reset">RESET</button></div>`;
    host.appendChild(toggle); host.appendChild(tunePanel);

    // Typing in the panel must not trigger game hotkeys (1/2/3 weapon swap, R, T, ...)
    tunePanel.addEventListener('keydown', (e) => e.stopPropagation());
    tunePanel.addEventListener('keyup', (e) => e.stopPropagation());

    toggle.addEventListener('click', () => { tunePanel.classList.toggle('hidden'); refreshTunePanel(); });
    tunePanel.addEventListener('input', (e) => {
        const t = e.target; if (!t.dataset || !t.dataset.g) return;
        const v = parseFloat(t.value); if (!isFinite(v)) return;
        tuneSet(t.dataset.g, t.dataset.a, v);
        if (t.dataset.g !== 'gun') loadoutTune.preview = t.dataset.g;
        refreshTunePanel();
    });
    tunePanel.addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'tune-prev') loadoutTune.preview = t.value;
        if (t.id === 'tune-axes') { loadoutTune.axes = t.checked; applyTuneAxes(); }
        refreshTunePanel();
    });

    const copy = async (text, btn) => {
        try { await navigator.clipboard.writeText(text); }
        catch (err) { const ta = document.getElementById('tune-out'); ta.select(); document.execCommand('copy'); }
        const old = btn.textContent; btn.textContent = 'COPIED'; setTimeout(() => btn.textContent = old, 900);
    };
    document.getElementById('tune-copy').addEventListener('click', (e) => { loadoutTune.showAll = false; refreshTunePanel(); copy(tuneSnippet(), e.currentTarget); });
    document.getElementById('tune-copy-all').addEventListener('click', (e) => { loadoutTune.showAll = true; refreshTunePanel(); copy(tuneAllSnippet(), e.currentTarget); });
    document.getElementById('tune-reset').addEventListener('click', () => {
        const k = adsTuneKey();
        ['hip', 'ads', 'gun'].forEach((g) => {
            const d = TUNE_DEFAULTS[g][k];
            if (d) tuneTable(g)[k] = { ...d }; else delete tuneTable(g)[k];
        });
        refreshTunePanel();
    });
})();

/* --- Main Game Loop --- */
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    updateTracers(delta);
    updateWeaponAnim(delta);   // applies ADS_TUNE / SCOPE_TUNE / SCOPE_ADS_TUNE, reload animation and shells (gunsLoad.js)
    if (controls.isLocked) {
        if (currentWeaponKey !== 'AWP' && window.isMouseDown) shoot();
        if (queuedShot && performance.now() >= sprintFireReadyAt) { queuedShot = false; if (currentWeaponKey === 'AWP') shoot(); }
        if (sprintCancelledByFire && shiftHeld && !isSprinting && !window.isMouseDown && !queuedShot && !isADS && playerStance === 'STAND' && performance.now() >= sprintFireReadyAt) {
            isSprinting = true; sprintCancelledByFire = false;
        }
        mouseSwayX = THREE.MathUtils.lerp(mouseSwayX, targetMouseSwayX, delta * 18);
        mouseSwayY = THREE.MathUtils.lerp(mouseSwayY, targetMouseSwayY, delta * 18);
        targetMouseSwayX = THREE.MathUtils.lerp(targetMouseSwayX, 0, delta * 22);
        targetMouseSwayY = THREE.MathUtils.lerp(targetMouseSwayY, 0, delta * 22);
        const horizSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        lastHorizSpeed = horizSpeed;
        if (horizSpeed > 0.5 && isGrounded) walkTime += delta * (isSprinting ? 15 : 9);
        else walkTime = THREE.MathUtils.lerp(walkTime, 0, delta * 5);
        const bobX = Math.sin(walkTime) * (isSprinting ? 0.022 : 0.011) * (isADS ? 0.15 : 1.0);
        const bobY = Math.cos(walkTime * 2) * (isSprinting ? 0.018 : 0.008) * (isADS ? 0.15 : 1.0);
        const sprintCarryAngle = (isSprinting && horizSpeed > 2 && !isADS) ? Math.PI / 7 : 0;
        const sprintCarryX = (isSprinting && horizSpeed > 2 && !isADS) ? 0.05 : 0;
        const adsK = isADS ? 0.5 : 1.0;
        const adsTuneData = customGunMesh && customGunMesh.userData ? customGunMesh.userData : {};
        const adsAimY = adsTuneData.adsAimY ?? 0.10;
        const adsX = isADS ? (adsTuneData.adsX ?? 0) : 0;
        const adsZ = isADS ? (adsTuneData.adsZ ?? -0.25) : -0.25;
        const baseGunX = (isADS ? adsX : 0.2) + sprintCarryX;
        const baseGunY = (isADS ? -adsAimY : -0.22) + landingDip;
        const baseGunZ = (isADS ? adsZ : -0.4) + recoilGunKickZ;
        gunGroup.position.x = THREE.MathUtils.lerp(gunGroup.position.x, baseGunX + bobX - mouseSwayX * adsK, delta * 14);
        gunGroup.position.y = THREE.MathUtils.lerp(gunGroup.position.y, baseGunY + bobY - mouseSwayY * adsK + (recoilGunRotX * 0.08), delta * 14);
        gunGroup.position.z = THREE.MathUtils.lerp(gunGroup.position.z, baseGunZ, delta * 16);
        gunGroup.rotation.z = THREE.MathUtils.lerp(gunGroup.rotation.z, -bobX * 1.5 - mouseSwayX * 2.2 * adsK + cameraRoll * 0.8 * adsK + recoilGunRotZ, delta * 14);
        gunGroup.rotation.y = THREE.MathUtils.lerp(gunGroup.rotation.y, mouseSwayX * 1.5 * adsK + Math.sin(walkTime) * 0.03 * adsK - sprintCarryAngle * 0.6 + recoilGunRotY, delta * 14);
        gunGroup.rotation.x = THREE.MathUtils.lerp(gunGroup.rotation.x, mouseSwayY * 1.5 * adsK + Math.cos(walkTime * 2) * 0.02 * adsK + sprintCarryAngle + recoilGunRotX, delta * 16);
        landingDip = THREE.MathUtils.lerp(landingDip, 0, delta * 8);
        const targetRoll = -direction.x * (isSprinting ? 0.04 : 0.02);
        cameraRoll = THREE.MathUtils.lerp(cameraRoll, targetRoll, delta * 8); camera.rotation.z = cameraRoll;

        const isSniperOverlay = ATTACHMENTS.scope[currentLoadout.scope]?.useSniperOverlay;
        if (isADS && isSniperOverlay && (performance.now() - adsStartTime) >= SNIPER_SCOPE_DELAY_MS) { gunGroup.visible = false; document.getElementById('sniper-scope').style.opacity = '1'; }
        else { gunGroup.visible = true; }
        
        const retDot = document.getElementById('reticle-reddot'); const retAcog = document.getElementById('reticle-acog');
        if (retDot) retDot.style.opacity = '0'; if (retAcog) retAcog.style.opacity = '0';
        
        const baseFOV = gameSettings.fov || 78; let targetFOV = baseFOV;
        const scopeConfig = ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron;
        if (isADS) targetFOV = baseFOV * (scopeConfig.fovMultiplier || 0.7);
        else if (isSprinting && horizSpeed > 2) targetFOV = baseFOV + 12;
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, delta * 10); camera.updateProjectionMatrix();
        
        const ch = document.getElementById('crosshair'); if (ch) ch.style.opacity = isADS ? '0' : '1';
        updateCrosshairVisuals();

        // Climb: the camera speed itself chases (pending * RECOIL_SMOOTH) with a lag, so every kick eases in and eases out
        // instead of moving at a constant speed.
        const velBlend = 1 - Math.exp(-RECOIL_ACCEL * delta);
        recoilPitchVel += (recoilPendingPitch * RECOIL_SMOOTH - recoilPitchVel) * velBlend;
        recoilYawVel += (recoilPendingYaw * RECOIL_SMOOTH - recoilYawVel) * velBlend;
        const clampStep = (step, pending) => pending >= 0 ? Math.max(0, Math.min(step, pending)) : Math.min(0, Math.max(step, pending));
        const stepPitch = clampStep(recoilPitchVel * delta, recoilPendingPitch);
        const stepYaw = clampStep(recoilYawVel * delta, recoilPendingYaw);
        recoilPendingPitch -= stepPitch; recoilPendingYaw -= stepYaw;

        // Recovery: after you stop firing, ease the camera back down (ease-in-out cubic, no constant-speed drop)
        const nowMs = performance.now();
        if (recoilAccumPitch > 0 && nowMs - lastRecoilShotTime > RECOIL_RECOVER_DELAY_MS) {
            recoverTotal = -recoilAccumPitch * RECOIL_RECOVER_FRAC; recoverApplied = 0; recoverStart = nowMs;
            recoverActive = true; recoilAccumPitch = 0;
        }
        let recoverStep = 0;
        if (recoverActive) {
            const t = Math.min(1, (nowMs - recoverStart) / RECOIL_RECOVER_MS);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const target = recoverTotal * e;
            recoverStep = target - recoverApplied; recoverApplied = target;
            if (t >= 1) recoverActive = false;
        }
        controls.pitchObject.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, controls.pitchObject.rotation.x + stepPitch + recoverStep));
        controls.yawObject.rotation.y += stepYaw;
        recoilGunKickZ = THREE.MathUtils.lerp(recoilGunKickZ, 0, delta * 10);
        recoilGunRotX = THREE.MathUtils.lerp(recoilGunRotX, 0, delta * 10);
        recoilGunRotY = THREE.MathUtils.lerp(recoilGunRotY, 0, delta * 9);
        recoilGunRotZ = THREE.MathUtils.lerp(recoilGunRotZ, 0, delta * 9);
        crosshairSpread = THREE.MathUtils.lerp(crosshairSpread, 0, delta * 9);
        if (!window.isMouseDown) continuousShots = Math.max(0, continuousShots - delta * 35);

        let targetEyeHeight = 1.6;
        if (playerStance === 'CROUCH') targetEyeHeight = 1.0;
        if (playerStance === 'PRONE') targetEyeHeight = 0.4;
        if (isGrounded) controls.getObject().position.y += (targetEyeHeight - controls.getObject().position.y) * 0.15;
        velocity.x -= velocity.x * 10.0 * delta; velocity.z -= velocity.z * 10.0 * delta; velocity.y -= 9.8 * 3.2 * delta;
        direction.z = Number(moveState.forward) - Number(moveState.backward);
        direction.x = Number(moveState.right) - Number(moveState.left); direction.normalize();
        const stockSpeedMod = ATTACHMENTS.stock[currentLoadout.stock]?.speedMod || 1.0;
        const stanceSpeed = isSprinting ? 115.0 : (playerStance === 'CROUCH' ? 28.0 : (playerStance === 'PRONE' ? 14.0 : 62.0));
        const baseSpeed = stanceSpeed * stockSpeedMod * (isADS ? 0.5 : 1);
        if (moveState.forward || moveState.backward) velocity.z -= direction.z * baseSpeed * delta;
        if (moveState.left || moveState.right) velocity.x -= direction.x * baseSpeed * delta;
        const playerObj = controls.getObject();
        playerObj.translateX(-velocity.x * delta); playerObj.translateZ(velocity.z * delta); playerObj.position.y += velocity.y * delta;
        if (playerObj.position.y < targetEyeHeight) {
            if (!isGrounded) { landingDip = -0.08; isGrounded = true; }
            velocity.y = 0; playerObj.position.y = targetEyeHeight; canJump = true;
        }
        const bound = arenaSize / 2 - 2;
        playerObj.position.x = Math.max(-bound, Math.min(bound, playerObj.position.x));
        playerObj.position.z = Math.max(-bound, Math.min(bound, playerObj.position.z));
        bots.forEach(bot => bot.update(delta, playerObj.position));
    }
    renderer.render(scene, camera);
}

window.onload = () => {
    const fovEl = document.getElementById('setting-fov');
    if (fovEl) {
        fovEl.value = gameSettings.fov; document.getElementById('val-setting-fov').innerText = `${gameSettings.fov}°`;
        document.getElementById('setting-volume').value = Math.round(gameSettings.volume * 100);
        document.getElementById('val-setting-volume').innerText = `${Math.round(gameSettings.volume * 100)}%`;
        document.getElementById('setting-sens').value = gameSettings.sensitivity;
        document.getElementById('val-setting-sens').innerText = `${gameSettings.sensitivity.toFixed(2)}x`;
    }
    updateLoadoutUI(); animate();
};