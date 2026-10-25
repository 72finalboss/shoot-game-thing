/*
game.js
Three.js engine, player controls/physics, bots, weapon gameplay, and audio.
Depends on Three.js + GLTFLoader and loads after gunsLoad.js.
Features:
- Nuketown 1950s Atomic Test Site Map
- Unobtrusive directional star muzzle flash
- Classic smooth lerp transition between running and walking
- Standing recovery after tactical slide
- Visible AWP Bolt-Action cycling animation
- Softened 6-DOF Spring Recoil, Wallbang Ballistics, Ledge Vaulting, Sniper Scope Breathing & Frag Grenades
- 1 Primary + 1 Secondary Weapon Loadout System
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

/* ============================================================================
   1. PROCEDURAL SPRING PHYSICS ENGINE
   ============================================================================ */
const MAX_SUBSTEP_DT = 1 / 120;
const _spDisp = new THREE.Vector3();
const _spForce = new THREE.Vector3();
const _spDamp = new THREE.Vector3();
const _spAccel = new THREE.Vector3();

class SpringVector3 {
    constructor(stiffness = 150, damping = 18, mass = 1) {
        this.target = new THREE.Vector3();
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = Math.max(0.0001, mass);
    }
    shove(impulse) { this.velocity.addScaledVector(impulse, 1 / this.mass); }
    setTarget(target) { this.target.copy(target); }
    reset(state = new THREE.Vector3()) {
        this.target.copy(state);
        this.position.copy(state);
        this.velocity.set(0, 0, 0);
    }
    update(dt) {
        const clampedDt = Math.min(dt, 0.1);
        const steps = Math.max(1, Math.ceil(clampedDt / MAX_SUBSTEP_DT));
        const stepDt = clampedDt / steps;
        const invMass = 1 / this.mass;
        for (let i = 0; i < steps; i++) {
            _spDisp.subVectors(this.position, this.target);
            _spForce.copy(_spDisp).multiplyScalar(-this.stiffness);
            _spDamp.copy(this.velocity).multiplyScalar(-this.damping);
            _spAccel.addVectors(_spForce, _spDamp).multiplyScalar(invMass);
            this.velocity.addScaledVector(_spAccel, stepDt);
            this.position.addScaledVector(this.velocity, stepDt);
        }
        return this.position;
    }
}

class SpringScalar {
    constructor(stiffness = 180, damping = 22, mass = 1, initialValue = 0) {
        this.target = initialValue;
        this.position = initialValue;
        this.velocity = 0;
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = Math.max(0.0001, mass);
    }
    shove(impulse) { this.velocity += impulse / this.mass; }
    setTarget(target) { this.target = target; }
    reset(value = 0) {
        this.target = value;
        this.position = value;
        this.velocity = 0;
    }
    update(dt) {
        const clampedDt = Math.min(dt, 0.1);
        const steps = Math.max(1, Math.ceil(clampedDt / MAX_SUBSTEP_DT));
        const stepDt = clampedDt / steps;
        const invMass = 1 / this.mass;
        for (let i = 0; i < steps; i++) {
            const displacement = this.position - this.target;
            const force = -this.stiffness * displacement - this.damping * this.velocity;
            const acceleration = force * invMass;
            this.velocity += acceleration * stepDt;
            this.position += this.velocity * stepDt;
        }
        return this.position;
    }
}

/* --- Three.js Scene Setup --- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e293b);
scene.fog = new THREE.FogExp2(0x1e293b, 0.0075);

const camera = new THREE.PerspectiveCamera(gameSettings.fov || 78, window.innerWidth / window.innerHeight, 0.06, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xffedd5, 0x334155, 0.72);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
dirLight.position.set(38, 65, 28);
dirLight.castShadow = false;
scene.add(dirLight);

const pitchObject = new THREE.Object3D();
pitchObject.add(camera);
const yawObject = new THREE.Object3D();
yawObject.position.set(-42, 1.6, 12);
yawObject.rotation.y = -Math.PI / 2;
yawObject.add(pitchObject);
scene.add(yawObject);

let baseYaw = -Math.PI / 2;
let basePitch = 0;

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
    if (!controls.isLocked && !isDead && mapReady) controls.lock();
});

/* ============================================================================
   2. WEAPONS, ATTACHMENTS & LOADOUT LOGIC
   ============================================================================ */
const FireMode = Object.freeze({ AUTO: 'AUTO', BURST: 'BURST', SEMI: 'SEMI', BOLT: 'BOLT' });

const WEAPONS = {
    m4a1: {
        name: 'M4A1 ASSAULT RIFLE',
        damage: 34, damage1: 22, range0: 30, range1: 105,
        fireRate: 800,
        availableModes: [FireMode.AUTO, FireMode.BURST, FireMode.SEMI],
        burstCount: 3, burstCooldown: 0.11,
        canChamberRound: true, muzzleVelocity: 320, penetrationDepth: 1.45,
        recoilClimb: 0.008, recoilKickH: 0.0032,
        gunKickZ: 0.011, gunKickUp: 0.004,
        gunRotX: 0.009, gunRotY: 0.004, gunRotZ: 0.007,
        spreadBase: 4, spreadMax: 20,
        maxClip: 30, reserve: 120,
        type: 'PRIMARY', soundProfile: 'm4a1', color: 0x38bdf8
    },
    AWP: {
        name: 'AWP SNIPER',
        damage: 98, damage1: 84, range0: 65, range1: 165,
        fireRate: 46,
        availableModes: [FireMode.BOLT],
        burstCount: 1, burstCooldown: 0,
        canChamberRound: true, muzzleVelocity: 480, penetrationDepth: 2.85,
        recoilClimb: 0.045, recoilKickH: 0.008,
        gunKickZ: 0.035, gunKickUp: 0.010,
        gunRotX: 0.050, gunRotY: 0.009, gunRotZ: 0.016,
        spreadBase: 26, spreadMax: 50,
        maxClip: 5, reserve: 25,
        type: 'PRIMARY', soundProfile: 'AWP', color: 0xf59e0b
    },
    mp5: {
        name: 'MP5 SUBMACHINE GUN',
        damage: 26, damage1: 16, range0: 20, range1: 75,
        fireRate: 900,
        availableModes: [FireMode.AUTO, FireMode.BURST, FireMode.SEMI],
        burstCount: 3, burstCooldown: 0.09,
        canChamberRound: true, muzzleVelocity: 260, penetrationDepth: 0.85,
        recoilClimb: 0.005, recoilKickH: 0.0038,
        gunKickZ: 0.0085, gunKickUp: 0.003,
        gunRotX: 0.005, gunRotY: 0.0035, gunRotZ: 0.0055,
        spreadBase: 5, spreadMax: 22,
        maxClip: 30, reserve: 120,
        type: 'PRIMARY', soundProfile: 'mp5', color: 0x10b981
    },
    svd: {
        name: 'SVD DRAGUNOV DMR',
        damage: 68, damage1: 52, range0: 55, range1: 150,
        fireRate: 260,
        availableModes: [FireMode.SEMI],
        burstCount: 1, burstCooldown: 0,
        canChamberRound: true, muzzleVelocity: 440, penetrationDepth: 2.35,
        recoilClimb: 0.022, recoilKickH: 0.0055,
        gunKickZ: 0.022, gunKickUp: 0.007,
        gunRotX: 0.028, gunRotY: 0.006, gunRotZ: 0.011,
        spreadBase: 8, spreadMax: 32,
        maxClip: 10, reserve: 50,
        type: 'PRIMARY', soundProfile: 'AWP', color: 0xf97316
    },
    toz34: {
        name: 'TOZ-34 SHOTGUN',
        damage: 18, damage1: 9, range0: 14, range1: 42,
        pellets: 8, pelletSpread: 0.036,
        fireRate: 300,
        availableModes: [FireMode.SEMI],
        burstCount: 1, burstCooldown: 0,
        canChamberRound: false, muzzleVelocity: 240, penetrationDepth: 0.70,
        recoilClimb: 0.032, recoilKickH: 0.007,
        gunKickZ: 0.028, gunKickUp: 0.009,
        gunRotX: 0.038, gunRotY: 0.008, gunRotZ: 0.014,
        spreadBase: 14, spreadMax: 34,
        maxClip: 2, reserve: 24,
        type: 'PRIMARY', soundProfile: 'AWP', color: 0xeab308
    },
    benellim4: {
        name: 'BENELLI M4 SHOTGUN',
        damage: 15, damage1: 7, range0: 12, range1: 38,
        pellets: 8, pelletSpread: 0.044,
        fireRate: 210,
        availableModes: [FireMode.SEMI],
        burstCount: 1, burstCooldown: 0,
        canChamberRound: true, muzzleVelocity: 230, penetrationDepth: 0.65,
        recoilClimb: 0.024, recoilKickH: 0.006,
        gunKickZ: 0.024, gunKickUp: 0.008,
        gunRotX: 0.030, gunRotY: 0.007, gunRotZ: 0.012,
        spreadBase: 16, spreadMax: 36,
        maxClip: 7, reserve: 35,
        type: 'PRIMARY', soundProfile: 'AWP', color: 0xef4444
    },
    m249: {
        name: 'M249 SAW LMG',
        damage: 32, damage1: 21, range0: 32, range1: 110,
        fireRate: 750,
        availableModes: [FireMode.AUTO],
        burstCount: 1, burstCooldown: 0,
        canChamberRound: false, muzzleVelocity: 310, penetrationDepth: 1.60,
        recoilClimb: 0.0095, recoilKickH: 0.0045,
        gunKickZ: 0.013, gunKickUp: 0.0045,
        gunRotX: 0.011, gunRotY: 0.005, gunRotZ: 0.008,
        spreadBase: 6, spreadMax: 26,
        maxClip: 100, reserve: 200,
        type: 'PRIMARY', soundProfile: 'm4a1', color: 0xa855f7
    },
    g17: {
        name: 'G17 GEN 5 MOS',
        damage: 28, damage1: 17, range0: 18, range1: 65,
        fireRate: 420,
        availableModes: [FireMode.SEMI],
        burstCount: 1, burstCooldown: 0,
        canChamberRound: true, muzzleVelocity: 250, penetrationDepth: 0.75,
        recoilClimb: 0.010, recoilKickH: 0.0035,
        gunKickZ: 0.014, gunKickUp: 0.005,
        gunRotX: 0.016, gunRotY: 0.004, gunRotZ: 0.007,
        spreadBase: 4, spreadMax: 18,
        maxClip: 17, reserve: 68,
        type: 'SECONDARY', soundProfile: 'mp5', color: 0x38bdf8
    },
    uzi: {
        name: 'IMI UZI SMG',
        damage: 22, damage1: 13, range0: 15, range1: 58,
        fireRate: 950,
        availableModes: [FireMode.AUTO, FireMode.SEMI],
        burstCount: 1, burstCooldown: 0,
        canChamberRound: false, muzzleVelocity: 235, penetrationDepth: 0.70,
        recoilClimb: 0.0065, recoilKickH: 0.0048,
        gunKickZ: 0.009, gunKickUp: 0.0035,
        gunRotX: 0.007, gunRotY: 0.0045, gunRotZ: 0.0065,
        spreadBase: 6, spreadMax: 24,
        maxClip: 32, reserve: 96,
        type: 'SECONDARY', soundProfile: 'mp5', color: 0x22c55e
    }
};

/* Melee weapon: no ammo, attacked with LMB (slash) / RMB (stab). Equip with E or 5. */
WEAPONS.bayonet = {
    name: 'M9 BAYONET', killLabel: 'M9 BAYONET',
    damage: 55, damage1: 55, range0: 2, range1: 2,
    fireRate: 120,
    availableModes: ['MELEE'],
    burstCount: 1, burstCooldown: 0,
    canChamberRound: false, muzzleVelocity: 0, penetrationDepth: 0,
    recoilClimb: 0, recoilKickH: 0, gunKickZ: 0, gunKickUp: 0,
    gunRotX: 0, gunRotY: 0, gunRotZ: 0,
    spreadBase: 0, spreadMax: 0,
    maxClip: 0, reserve: 0,
    type: 'MELEE', soundProfile: 'bayonet', color: 0x94a3b8
};

const ATTACHMENTS = {
    scope: {
        iron: { name: 'Iron Sights (Fast ADS)', fovMultiplier: 0.75, useSniperOverlay: false },
        reddot: { name: 'Coyote Red Dot Sight', fovMultiplier: 0.65, useSniperOverlay: false },
        acog: { name: 'ACOG 4x Tactical Scope', fovMultiplier: 0.42, useSniperOverlay: false, recoilMod: 1.12 },
        sniper: { name: '8x High-Power Sniper Scope', fovMultiplier: 0.22, useSniperOverlay: true, recoilMod: 1.2 }
    },
    muzzle: {
        none: { name: 'Standard Flash Hider', recoilClimbMod: 1.0, recoilKickHMod: 1.0 },
        suppressor: { name: 'PBS Tactical Suppressor', recoilClimbMod: 0.78, recoilKickHMod: 0.82 },
        compensator: { name: 'Recoil Compensator', recoilClimbMod: 0.92, recoilKickHMod: 0.65 },
        brake: { name: 'Heavy Muzzle Brake', recoilClimbMod: 0.70, recoilKickHMod: 1.05 }
    },
    stock: {
        standard: { name: 'Standard Tactical Stock', recoilClimbMod: 1.0, speedMod: 1.0 },
        skeletal: { name: 'Skeletal Minimalist Stock', recoilClimbMod: 1.10, speedMod: 1.20 },
        heavy: { name: 'Heavy Sniper Stock', recoilClimbMod: 0.75, speedMod: 0.90 },
        folded: { name: 'CQB No Stock / Folded', recoilClimbMod: 1.15, speedMod: 1.25 }
    },
    mag: {
        standard: { name: 'Standard Magazine', clipMod: 1.0 },
        extended: { name: 'Extended Mag (+50%)', clipMod: 1.5 },
        drum: { name: 'High-Cap Drum Mag (+100%)', clipMod: 2.0 }
    },
    handle: {
        none: { name: 'None (Standard Handguard)', recoilClimbMod: 1.0, recoilKickHMod: 1.0 },
        vertical: { name: 'Vertical Foregrip (-Recoil)', recoilClimbMod: 0.75, recoilKickHMod: 0.88 },
        angled: { name: 'Angled Grip (+ADS Speed)', recoilClimbMod: 0.88, recoilKickHMod: 0.85 },
        stubby: { name: 'Tactical Stubby Grip (+Stability)', recoilClimbMod: 0.82, recoilKickHMod: 0.75 },
        skeleton: { name: 'Skeleton Grip (+Handling)', recoilClimbMod: 0.86, recoilKickHMod: 0.80 },
        folding: { name: 'Folding Grip (-Recoil)', recoilClimbMod: 0.78, recoilKickHMod: 0.90 }
    }
};

const defaultLoadout = { scope: 'iron', muzzle: 'none', stock: 'standard', mag: 'standard', handle: 'none' };
const loadouts = {
    m4a1:      { ...defaultLoadout, gun: 'm4a1' },
    AWP:       { ...defaultLoadout, gun: 'AWP', scope: 'sniper' },
    mp5:       { ...defaultLoadout, gun: 'mp5' },
    svd:       { ...defaultLoadout, gun: 'svd', scope: 'sniper' },
    toz34:     { ...defaultLoadout, gun: 'toz34' },
    benellim4: { ...defaultLoadout, gun: 'benellim4' },
    m249:      { ...defaultLoadout, gun: 'm249' },
    g17:       { ...defaultLoadout, gun: 'g17' },
    uzi:       { ...defaultLoadout, gun: 'uzi' },
    bayonet:   { ...defaultLoadout, gun: 'bayonet' }
};

/* 1 PRIMARY + 1 SECONDARY SPAWN LOADOUT STATE */
loadouts.bayonet = loadouts.bayonet || { scope: 'iron', muzzle: 'none', stock: 'standard', mag: 'standard', handle: 'none' };
Object.keys(WEAPONS).forEach(k => { if (WEAPONS[k].type === 'SECONDARY' && loadouts[k]) { loadouts[k].stock = 'standard'; loadouts[k].handle = 'none'; } });
let selectedPrimaryKey = 'm4a1';
let selectedSecondaryKey = 'g17';
let activeSlot = 'primary'; 
let spawnedSlots = {
    primary:   { key: 'm4a1', clip: 31, reserve: 120, fireModeIndex: 0 },
    secondary: { key: 'g17',  clip: 18, reserve: 68,  fireModeIndex: 0 },
    melee:     { key: 'bayonet', clip: 0, reserve: 0, fireModeIndex: 0 }
};

let currentWeaponKey = selectedPrimaryKey;
let currentWeapon = WEAPONS[currentWeaponKey];
let currentLoadout = loadouts[currentWeaponKey];
let ammoClip = currentWeapon.maxClip + 1;
let ammoReserve = currentWeapon.reserve;
let currentFireModeIndex = 0;
let currentFireMode = currentWeapon.availableModes[0];
let burstShotsRemaining = 0;
let semiFiredThisPull = false;

/* --- Melee (M9 bayonet) State --- */
const MELEE_HIT_AT = 0.42; // fraction of the swing at which the blade connects
const MELEE_ATTACKS = {
    // arc = extra ray offsets (right, up) fanned around the crosshair so close targets are easy to hit
    slash: { duration: 0.50, damage: 55, range: 2.1, arc: [[0, 0], [-0.2, 0], [0.2, 0], [-0.38, 0], [0.38, 0], [0, 0.18], [0, -0.18]] },
    stab:  { duration: 0.70, damage: 90, range: 2.4, arc: [[0, 0], [-0.1, 0], [0.1, 0], [0, 0.1], [0, -0.1]] }
};
const meleeState = { active: false, type: 'slash', t: 0, hitDone: false, side: -1 };
const meleeOffset = { pos: new THREE.Vector3(), rot: new THREE.Vector3() };
const meleeRay = new THREE.Raycaster();

/* --- Weapon inspect (F) state --- */
const inspectState = { active: false, t: 0, weight: 0, clicked: false, melee: false };
const inspectOffset = { pos: new THREE.Vector3(), rot: new THREE.Vector3() };
const INSPECT_DURATION = { gun: 3.6, melee: 2.8 };
/* Keyframes: [u, posX, posY, posZ, rotX, rotY, rotZ] - offsets from the normal hold (metres / radians).
   u runs 0..1 over the duration; poses are eased between keys, so each key is a place the weapon briefly settles. */
const INSPECT_FRAMES = {
    gun: [
        [0.00,  0.00,  0.00,  0.00,   0.00,  0.00,  0.00],
        [0.14, -0.10,  0.05,  0.07,   0.12,  0.50, -0.30],   // raise, turn to show the right side
        [0.40, -0.12,  0.07,  0.08,   0.22,  0.85, -0.50],   // tilt to look over the top
        [0.62, -0.06,  0.05,  0.07,   0.10, -0.55,  0.40],   // swing across to the left side
        [0.84, -0.05,  0.04,  0.05,   0.30, -0.15,  0.10],   // muzzle up, check the sights
        [1.00,  0.00,  0.00,  0.00,   0.00,  0.00,  0.00]
    ],
    melee: [
        [0.00,  0.00,  0.00,  0.00,   0.00,  0.00,  0.00],
        [0.20, -0.10,  0.10,  0.05,  -0.30,  0.30, -0.60],   // lift the blade
        [0.50, -0.08,  0.08,  0.02,  -0.55,  0.50, -2.80],   // flip it over
        [0.80, -0.06,  0.06,  0.02,  -0.40,  0.20, -5.40],   // finish the spin
        [1.00,  0.00,  0.00,  0.00,   0.00,  0.00, -6.2832]  // back in hand (same pose as rest, one full turn)
    ]
};
let lastGunSlot = 'primary';

/* --- AWP Visible Bolt-Action Cycling State --- */
var isBoltCycling = false;
let pendingBoltCycle = false;
let boltCycleTimer = 0;
const BOLT_CYCLE_DURATION = 0.95;
let wasRMBHeldDuringBolt = false;

/* --- Spring Instances for Softened Recoil & Stance Height --- */
const adsSpring = new SpringScalar(240, 26, 1, 0);
const recoilPosSpring = new SpringVector3(190, 16, 1);
const recoilRotSpring = new SpringVector3(175, 14, 1);
const cameraRecoilSpring = new SpringVector3(150, 18, 1);
const eyeHeightSpring = new SpringScalar(210, 24, 1, 1.6);

let mouseSwayX = 0; let mouseSwayY = 0; let targetMouseSwayX = 0; let targetMouseSwayY = 0;
let walkTime = 0; let landingDip = 0; let cameraRoll = 0;
let gunBasePosX = 0.2, gunBasePosY = -0.22, gunBasePosZ = -0.4;
let gunBaseRotX = 0, gunBaseRotY = 0, gunBaseRotZ = 0;

document.addEventListener('mousemove', (e) => {
    if (!controls.isLocked || isDead) return;
    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;
    const sens = 0.002 * (gameSettings.sensitivity || 1.0);
    baseYaw -= movementX * sens;
    basePitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, basePitch - movementY * sens));
    targetMouseSwayX += movementX * 0.00025 * (gameSettings.sensitivity || 1.0);
    targetMouseSwayY += movementY * 0.00025 * (gameSettings.sensitivity || 1.0);
});
/* --- Map State & Waypoints --- */
let mapReady = false;
let MAP_IS_CUSTOM = false;
const MAP_BOUNDS = { minX: -52, maxX: 52, minZ: -52, maxZ: 52 };
const MAP_SPAWNS = [{ pos: new THREE.Vector3(-42, 1.6, 12), yaw: -Math.PI / 2 }];

const NUKETOWN_WAYPOINTS = [
    new THREE.Vector3(-12, 0, -8),
    new THREE.Vector3(12, 0, -8),
    new THREE.Vector3(12, 0, 10),
    new THREE.Vector3(-12, 0, 10),
    new THREE.Vector3(0, 0, -14),
    new THREE.Vector3(0, 0, 14),
    new THREE.Vector3(16, 0, 0),
    new THREE.Vector3(-16, 0, 0)
];

/* --- Game State Variables --- */
let teamScorePhantoms = 150; 
let teamScoreGhosts = 135; 
let playerScore = 0;
let lastAttacker = null; 
let isADS = false; 
let adsStartTime = 0;
const SNIPER_SCOPE_DELAY_MS = 150;
let isSprinting = false; 
let playerStance = 'STAND';
let health = 100; 
let isReloading = false; 
let isDead = false;
let respawnInterval = null; 
let lastShotTime = 0; 
let killCount = 0; 
let deathCount = 0;

/* --- Sliding & Vaulting State --- */
let isSliding = false; 
let slideTimer = 0; 
let slideCooldown = 0;
const SLIDE_DURATION = 0.72; 
const SLIDE_COOLDOWN = 0.75;
const slideVel = new THREE.Vector3();

let isVaulting = false; 
let vaultTimer = 0; 
const VAULT_DURATION = 0.32;
const vaultStartPos = new THREE.Vector3(); 
const vaultEndPos = new THREE.Vector3();
const vaultRay = new THREE.Raycaster();

/* --- Sniper Breathing & Grenade State --- */
let breathTime = 0; 
let breathStamina = 1.0; 
let breathExhausted = false;
let isHoldingBreath = false; 
let prevBreathOffsetX = 0; 
let prevBreathOffsetY = 0;
const MAX_BREATH_DURATION = 4.0;

const MAX_GRENADES = 3; 
let grenadeCount = MAX_GRENADES; 
let lastGrenadeTime = 0;
const GRENADE_COOLDOWN_MS = 900; 
const GRENADE_FUSE = 2.5; 
const GRENADE_RADIUS = 14.0;
const activeGrenades = []; 
const activeExplosions = [];
/* --- Movement / HUD State (restored) --- */
const moveState = { forward: false, backward: false, left: false, right: false };
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let canJump = false;
let isGrounded = true;
const clock = new THREE.Clock();
const SPRINT_FIRE_DELAY_MS = 160;
const SPRINT_RESUME_DELAY_MS = 400; // how long after the last shot before sprint can resume
let sprintFireReadyAt = 0;
let sprintResumeAt = 0;
let sprintCancelledByFire = false;
let shiftHeld = false;
let queuedShot = false;
let lastHorizSpeed = 0;
let continuousShots = 0;
let crosshairSpread = 0;
const crosshairBloomSpring = new SpringScalar(340, 22, 1, 0);
let _tracerGeo = null;
let _tracerHeadMat = null;
const _tracerTrailMats = {};
let _hmTimeout = null;
let _hmScaleTimeout = null;
let matchTimeSeconds = 9 * 60 + 45;
const MAX_TEAM_TICKETS = 200;
const radialRay = new THREE.Raycaster();
const RADIAL_ANGLES = [0, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75, Math.PI, Math.PI * 1.25, Math.PI * 1.5, Math.PI * 1.75];
const PLAYER_RADIUS = 0.45;

/* ============================================================================
   3. MAP / ENVIRONMENT LOGIC
   ============================================================================ */
const MaterialResistance = Object.freeze({
    glass: 0.2, drywall: 0.35, flesh: 0.45, wood: 0.55, brick: 1.35, concrete: 1.65, steel: 3.5
});

const collidableObjects = [];
const arenaSize = 128;

function addMapBox(size, pos, rotY, colorHex, materialType = 'concrete', opacity = 1.0, roughness = 0.65, metalness = 0.15) {
    const mat = new THREE.MeshStandardMaterial({
        color: colorHex, roughness: materialType === 'glass' ? 0.12 : roughness,
        metalness: materialType === 'steel' ? 0.55 : metalness,
        transparent: opacity < 1.0, opacity: opacity
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...pos);
    if (rotY) mesh.rotation.y = rotY;
    mesh.userData = { materialType, penetrationResistance: MaterialResistance[materialType] ?? 1.65 };
    scene.add(mesh);
    collidableObjects.push(mesh);
    return mesh;
}

function buildNuketownHouse(centerX, centerZ, facingSign, mainColorHex, trimColorHex, roofColorHex) {
    const W = 12; const L = 14; const H1 = 4.2; const H2 = 3.8; const wallT = 0.4;
    const frontX = centerX + facingSign * (W / 2);
    const backX = centerX - facingSign * (W / 2);
    addMapBox([W + 0.6, 0.2, L + 0.6], [centerX, 0.1, centerZ], 0, 0x64748b, 'concrete');
    addMapBox([wallT, H1, 4.2], [frontX, H1 / 2, centerZ - 4.9], 0, mainColorHex, 'drywall');
    addMapBox([wallT, 1.1, 4.8], [frontX, 0.55, centerZ + 2.6], 0, mainColorHex, 'drywall');
    addMapBox([wallT, 1.0, 4.8], [frontX, H1 - 0.5, centerZ + 2.6], 0, mainColorHex, 'drywall');
    addMapBox([0.1, 2.1, 4.6], [frontX, 2.15, centerZ + 2.6], 0, 0x7dd3fc, 'glass', 0.32);
    addMapBox([wallT, H1, 2.0], [frontX, H1 / 2, centerZ + 6.0], 0, mainColorHex, 'drywall');
    addMapBox([wallT, 1.2, 2.2], [frontX, H1 - 0.6, centerZ - 1.7], 0, trimColorHex, 'wood');
    addMapBox([wallT, H1, 4.5], [backX, H1 / 2, centerZ - 4.75], 0, mainColorHex, 'drywall');
    addMapBox([wallT, H1, 4.5], [backX, H1 / 2, centerZ + 4.75], 0, mainColorHex, 'drywall');
    addMapBox([wallT, 1.2, 5.0], [backX, H1 - 0.6, centerZ], 0, trimColorHex, 'wood');
    addMapBox([W, H1, wallT], [centerX, H1 / 2, centerZ - L / 2], 0, mainColorHex, 'drywall');
    addMapBox([W, H1, wallT], [centerX, H1 / 2, centerZ + L / 2], 0, mainColorHex, 'drywall');
    addMapBox([5.5, H1, 0.3], [centerX - facingSign * 1.2, H1 / 2, centerZ + 0.8], 0, 0xfef3c7, 'drywall');
    addMapBox([2.4, 0.95, 1.5], [centerX + facingSign * 1.8, 0.5, centerZ + 3.2], 0, 0x92400e, 'wood');
    addMapBox([W + 3.6, 0.35, L + 0.4], [centerX, H1 + 0.17, centerZ], 0, 0x475569, 'concrete');
    const frontBalconyX = frontX + facingSign * 1.5;
    addMapBox([0.25, 1.05, L], [frontBalconyX, H1 + 0.7, centerZ], 0, trimColorHex, 'wood');
    addMapBox([1.6, 0.25, 0.25], [frontX + facingSign * 0.8, H1 + 0.7, centerZ - L / 2 + 0.15], 0, trimColorHex, 'wood');
    addMapBox([1.6, 0.25, 0.25], [frontX + facingSign * 0.8, H1 + 0.7, centerZ + L / 2 - 0.15], 0, trimColorHex, 'wood');
    const y2 = H1 + 0.35 + H2 / 2;
    addMapBox([wallT, H2, 4.0], [frontX, y2, centerZ - 5.0], 0, mainColorHex, 'drywall');
    addMapBox([wallT, H2, 4.0], [frontX, y2, centerZ + 5.0], 0, mainColorHex, 'drywall');
    addMapBox([wallT, 1.05, 6.0], [frontX, H1 + 0.35 + 0.52, centerZ], 0, mainColorHex, 'drywall');
    addMapBox([wallT, 0.85, 6.0], [frontX, H1 + 0.35 + H2 - 0.42, centerZ], 0, trimColorHex, 'wood');
    addMapBox([0.08, 1.9, 5.8], [frontX, y2 + 0.1, centerZ], 0, 0xbae6fd, 'glass', 0.28);
    addMapBox([wallT, H2, 4.6], [backX, y2, centerZ - 4.7], 0, mainColorHex, 'drywall');
    addMapBox([wallT, H2, 4.6], [backX, y2, centerZ + 4.7], 0, mainColorHex, 'drywall');
    addMapBox([wallT, 0.9, 4.8], [backX, H1 + 0.35 + H2 - 0.45, centerZ], 0, trimColorHex, 'wood');
    addMapBox([W, H2, wallT], [centerX, y2, centerZ - L / 2], 0, mainColorHex, 'drywall');
    addMapBox([W, H2, wallT], [centerX, y2, centerZ + L / 2], 0, mainColorHex, 'drywall');
    addMapBox([W + 2.4, 0.5, L + 1.4], [centerX, H1 + H2 + 0.55, centerZ], 0, roofColorHex, 'wood');
    addMapBox([1.6, H1 + H2 + 2.4, 1.6], [centerX, (H1 + H2 + 2.4) / 2, centerZ + (facingSign > 0 ? -L / 2 - 0.7 : L / 2 + 0.7)], 0, 0x991b1b, 'brick');
    const rampBaseX = backX - facingSign * 2.2;
    const numSteps = 9;
    for (let s = 0; s < numSteps; s++) {
        const frac = (s + 1) / numSteps;
        const stepH = frac * (H1 + 0.25);
        const stepZ = centerZ - 5.2 + s * 1.15;
        addMapBox([2.6, stepH, 1.25], [rampBaseX, stepH / 2, stepZ], 0, 0x78350f, 'wood');
    }
}

function buildYellowSchoolBus(cx, cz, rotY) {
    const busGroup = new THREE.Group();
    busGroup.position.set(cx, 0, cz);
    busGroup.rotation.y = rotY;
    scene.add(busGroup);
    const L = 13.5, W = 3.2;
    addMapBox([W, 1.35, L], [cx, 0.95, cz], rotY, 0xfacc15, 'steel', 1.0, 0.4, 0.45);
    addMapBox([W, 0.35, L - 1.4], [cx, 3.15, cz - 0.5], rotY, 0xeab308, 'steel', 1.0, 0.45, 0.4);
    addMapBox([W + 0.05, 1.1, L - 2.4], [cx, 2.25, cz - 0.4], rotY, 0x38bdf8, 'glass', 0.32);
    const hoodOffset = new THREE.Vector3(0, 1.0, L / 2 - 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    addMapBox([W - 0.3, 1.25, 1.8], [cx + hoodOffset.x, 1.0, cz + hoodOffset.z], rotY, 0xf59e0b, 'steel');
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
    [[-1.6, 0.55, -4.0], [1.6, 0.55, -4.0], [-1.6, 0.55, 3.8], [1.6, 0.55, 3.8]].forEach(wp => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 14), wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(...wp);
        busGroup.add(w);
    });
}

function buildMovingTruck(cx, cz, rotY) {
    addMapBox([3.3, 3.4, 9.2], [cx, 1.9, cz - 1.2], rotY, 0xf8fafc, 'steel', 1.0, 0.5, 0.3);
    addMapBox([3.35, 0.8, 9.25], [cx, 1.2, cz - 1.2], rotY, 0x0284c7, 'steel', 1.0, 0.4, 0.45);
    const cabOff = new THREE.Vector3(0, 0, 4.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    addMapBox([3.0, 2.3, 2.8], [cx + cabOff.x, 1.35, cz + cabOff.z], rotY, 0x0284c7, 'steel');
}

function buildVintageCar(cx, cz, rotY, bodyColorHex) {
    addMapBox([2.2, 0.95, 4.8], [cx, 0.55, cz], rotY, bodyColorHex, 'steel', 1.0, 0.3, 0.6);
    addMapBox([1.9, 0.65, 2.3], [cx, 1.32, cz - 0.2], rotY, 0xf8fafc, 'glass', 0.45);
}

function buildNuketownSign(x, z) {
    addMapBox([0.35, 3.2, 0.35], [x - 2.4, 1.6, z], 0, 0x475569, 'steel');
    addMapBox([0.35, 3.2, 0.35], [x + 2.4, 1.6, z], 0, 0x475569, 'steel');
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 10; ctx.strokeRect(10, 10, 492, 236);
    ctx.fillStyle = '#facc15'; ctx.font = 'bold 26px monospace'; ctx.fillText('WELCOME TO', 42, 58);
    ctx.fillStyle = '#38bdf8'; ctx.font = 'bold 58px sans-serif'; ctx.fillText('NUKETOWN', 38, 125);
    ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 28px monospace'; ctx.fillText('POPULATION: 00005', 42, 185);
    ctx.fillStyle = '#ef4444'; ctx.font = 'bold 20px monospace'; ctx.fillText('ATOMIC TEST SITE NV-5', 42, 222);
    const tex = new THREE.CanvasTexture(canvas);
    const boardMat = new THREE.MeshBasicMaterial({ map: tex });
    const board = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.1, 0.35), boardMat);
    board.position.set(x, 4.2, z);
    board.userData = { materialType: 'wood', penetrationResistance: MaterialResistance.wood };
    scene.add(board);
    collidableObjects.push(board);
}

function buildDoomsdayNukeTower(x, z) {
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, metalness: 0.7, roughness: 0.4, wireframe: true });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 7.5, 58, 8, 12), towerMat);
    tower.position.set(x, 29, z);
    scene.add(tower);
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.5, roughness: 0.4 });
    const bomb = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 16), cabMat);
    bomb.scale.y = 1.6;
    bomb.position.set(x, 59, z);
    scene.add(bomb);
    const beacon = new THREE.PointLight(0xef4444, 4, 60);
    beacon.position.set(x, 65, z);
    scene.add(beacon);
}

function buildNuketownMap() {
    const desertFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(arenaSize * 2, arenaSize * 2),
        new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.92 })
    );
    desertFloor.rotation.x = -Math.PI / 2;
    desertFloor.userData = { materialType: 'concrete', penetrationResistance: 1.65 };
    scene.add(desertFloor);
    collidableObjects.push(desertFloor);

    const roadMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(76, 36),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
    );
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.y = 0.02;
    scene.add(roadMesh);

    const circleRoad = new THREE.Mesh(
        new THREE.CircleGeometry(22, 32),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
    );
    circleRoad.rotation.x = -Math.PI / 2;
    circleRoad.position.set(0, 0.025, -4);
    scene.add(circleRoad);

    [-32, 32].forEach(lx => {
        const lawn = new THREE.Mesh(
            new THREE.PlaneGeometry(36, 52),
            new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 })
        );
        lawn.rotation.x = -Math.PI / 2;
        lawn.position.set(lx, 0.03, 0);
        scene.add(lawn);
    });

    const wallH = 10, wallT = 2, bnd = 56;
    addMapBox([bnd * 2, wallH, wallT], [0, wallH / 2, -bnd], 0, 0x334155, 'concrete');
    addMapBox([bnd * 2, wallH, wallT], [0, wallH / 2, bnd], 0, 0x334155, 'concrete');
    addMapBox([wallT, wallH, bnd * 2], [-bnd, wallH / 2, 0], 0, 0x334155, 'concrete');
    addMapBox([wallT, wallH, bnd * 2], [bnd, wallH / 2, 0], 0, 0x334155, 'concrete');

    buildNuketownHouse(-25, 0, 1, 0x0d9488, 0xf8fafc, 0x1e293b);
    buildNuketownHouse(25, 0, -1, 0xeab308, 0xfef08a, 0x451a03);

    buildYellowSchoolBus(-4.2, -1.5, 0.16);
    buildMovingTruck(4.8, 2.2, -0.18);
    buildVintageCar(-13, 14, 0.35, 0xe11d48);
    buildVintageCar(13, -14, -0.4, 0x0284c7);

    const picketPositions = [
        { size: [14, 1.05, 0.22], pos: [-25, 0.52, -14] },
        { size: [14, 1.05, 0.22], pos: [-25, 0.52, 14] },
        { size: [14, 1.05, 0.22], pos: [25, 0.52, -14] },
        { size: [14, 1.05, 0.22], pos: [25, 0.52, 14] },
        { size: [0.22, 1.15, 22], pos: [-46, 0.58, 0] },
        { size: [0.22, 1.15, 22], pos: [46, 0.58, 0] },
        { size: [4.2, 1.0, 0.65], pos: [-12, 0.5, -11] },
        { size: [4.2, 1.0, 0.65], pos: [12, 0.5, 11] }
    ];
    picketPositions.forEach((p, idx) => {
        addMapBox(p.size, p.pos, 0, idx >= 6 ? 0x166534 : 0xf8fafc, 'wood');
    });

    addMapBox([3.5, 0.95, 3.5], [-38, 0.48, -10], 0, 0x475569, 'steel');
    addMapBox([3.5, 0.95, 3.5], [38, 0.48, 10], 0, 0x475569, 'steel');

    buildNuketownSign(0, -24);
    buildDoomsdayNukeTower(0, -78);
}

const _groundMatCache = new Map();
function groundTileMaterial(mat) {
    if (!_groundMatCache.has(mat)) {
        const m = mat.clone();
        m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 8;
        _groundMatCache.set(mat, m);
    }
    return _groundMatCache.get(mat);
}

const _clearRay = new THREE.Raycaster();
function probeOpenSpace(x, z) {
    let minD = Infinity, bestD = 0, bestAng = 0;
    const origin = new THREE.Vector3(x, 1.0, z);
    for (let i = 0; i < 8; i++) {
        const ang = i * Math.PI / 4;
        _clearRay.set(origin, new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)));
        _clearRay.near = 0; _clearRay.far = 40;
        const h = _clearRay.intersectObjects(collidableObjects, false);
        const dist = h.length ? h[0].distance : 40;
        minD = Math.min(minD, dist);
        if (dist > bestD) { bestD = dist; bestAng = ang; }
    }
    _clearRay.set(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0));
    _clearRay.far = 6;
    const g = _clearRay.intersectObjects(collidableObjects, false);
    const grounded = g.length > 0 && g[0].point.y > -0.9 && g[0].point.y < 0.6;
    return { minD, bestD, bestAng, grounded };
}

/* --- Breakable Glass --- */
const GLASS_SHARD_MAX = 900;
const glassShardState = [];
let glassShardMesh = null, glassShardCursor = 0, glassLastSoundAt = 0;
const _gsDummy = new THREE.Object3D();
const _gsA = new THREE.Vector3(), _gsB = new THREE.Vector3(), _gsC = new THREE.Vector3();

function initGlassShards() {
    if (glassShardMesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0.55, 0, -0.5, -0.3, 0, 0.5, -0.3, 0]), 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
        color: 0xcfeeff, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.7,
        side: THREE.DoubleSide, depthWrite: false
    });
    glassShardMesh = new THREE.InstancedMesh(geo, mat, GLASS_SHARD_MAX);
    glassShardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    glassShardMesh.frustumCulled = false;
    _gsDummy.scale.setScalar(0); _gsDummy.updateMatrix();
    for (let i = 0; i < GLASS_SHARD_MAX; i++) {
        glassShardMesh.setMatrixAt(i, _gsDummy.matrix);
        glassShardState.push({
            alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
            rot: new THREE.Euler(), spin: new THREE.Vector3(), size: new THREE.Vector3(),
            age: 0, life: 1, floorY: 0, landed: false
        });
    }
    glassShardMesh.instanceMatrix.needsUpdate = true;
    scene.add(glassShardMesh);
}

function playGlassBreakSound(intensity = 1) {
    const now = performance.now();
    if (now - glassLastSoundAt < 50) return;
    glassLastSoundAt = now;
    try {
        if (typeof audioCtx === 'undefined' || !audioCtx) return;
        const ctx = audioCtx, t0 = ctx.currentTime, vol = (gameSettings.volume ?? 1) * Math.min(1, 0.45 + 0.2 * intensity);
        const len = Math.floor(ctx.sampleRate * 0.45);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.exp(-i / (ctx.sampleRate * 0.07)) + 0.35 * Math.exp(-i / (ctx.sampleRate * 0.2)) * (Math.random() < 0.02 ? 1 : 0.15);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const noise = ctx.createBufferSource(); noise.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
        const g = ctx.createGain(); g.gain.value = 0.55 * vol;
        noise.connect(hp); hp.connect(g); g.connect(ctx.destination);
        noise.start(t0);
        for (let k = 0; k < 4; k++) {
            const osc = ctx.createOscillator(), og = ctx.createGain();
            const st = t0 + 0.02 + Math.random() * 0.22;
            osc.type = 'sine'; osc.frequency.value = 2600 + Math.random() * 3800;
            og.gain.setValueAtTime(0.0001, st);
            og.gain.exponentialRampToValueAtTime(0.07 * vol, st + 0.004);
            og.gain.exponentialRampToValueAtTime(0.0001, st + 0.09);
            osc.connect(og); og.connect(ctx.destination);
            osc.start(st); osc.stop(st + 0.1);
        }
    } catch (e) {}
}

function prepareBreakableGlass(mesh) {
    const geo = mesh.geometry.clone(); mesh.geometry = geo;
    const pos = geo.attributes.position;
    if (!geo.index) {
        const seq = new Uint32Array(pos.count);
        for (let i = 0; i < seq.length; i++) seq[i] = i;
        geo.setIndex(new THREE.BufferAttribute(seq, 1));
    }
    const idx = geo.index.array;
    const triCount = Math.floor(idx.length / 3);
    geo.computeBoundingBox();
    const q = Math.max(1e-6, geo.boundingBox.getSize(new THREE.Vector3()).length() * 1e-5);

    const weld = new Map(), vid = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
        const key = Math.round(pos.getX(i)/q) + ',' + Math.round(pos.getY(i)/q) + ',' + Math.round(pos.getZ(i)/q);
        let id = weld.get(key);
        if (id === undefined) { id = weld.size; weld.set(key, id); }
        vid[i] = id;
    }
    const parent = new Int32Array(weld.size);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < triCount; t++) {
        const a = find(vid[idx[t * 3]]), b = find(vid[idx[t * 3 + 1]]), c = find(vid[idx[t * 3 + 2]]);
        parent[b] = a; parent[find(c)] = a;
    }
    const paneOfTri = new Int32Array(triCount), rootToPane = new Map(), panes = [];
    for (let t = 0; t < triCount; t++) {
        const r = find(vid[idx[t * 3]]);
        let p = rootToPane.get(r);
        if (p === undefined) { p = panes.length; rootToPane.set(r, p); panes.push({ tris: [], broken: false }); }
        paneOfTri[t] = p; panes[p].tris.push(t);
    }
    mesh.userData.glass = { paneOfTri, panes, alive: panes.length };
}

function removeGlassMeshIfEmpty(mesh) {
    if (mesh.userData.glass.alive > 0) return;
    mesh.visible = false;
    const i = collidableObjects.indexOf(mesh);
    if (i > 0) collidableObjects.splice(i, 1);
}

function spawnGlassShards(mesh, pane, dir, burst) {
    initGlassShards();
    const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index.array;
    mesh.updateWorldMatrix(true, false);
    const M = mesh.matrixWorld;
    const tris = []; let area = 0;
    const centre = new THREE.Vector3();
    for (const t of pane.tris) {
        const v = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3 + k]).applyMatrix4(M));
        const a = _gsA.subVectors(v[1], v[0]).cross(_gsB.subVectors(v[2], v[0])).length() * 0.5;
        area += a; tris.push({ v, a });
        centre.add(v[0]).add(v[1]).add(v[2]);
    }
    centre.divideScalar(Math.max(1, tris.length * 3));
    const n = THREE.MathUtils.clamp(Math.round(area * 7), 10, 42);
    const baseSize = THREE.MathUtils.clamp(Math.sqrt(area / n) * 1.5, 0.07, 0.34);
    for (let i = 0; i < n; i++) {
        let r = Math.random() * area, tri = tris[tris.length - 1];
        for (const T of tris) { if ((r -= T.a) <= 0) { tri = T; break; } }
        let u = Math.random(), w = Math.random();
        if (u + w > 1) { u = 1 - u; w = 1 - w; }
        const s = glassShardState[glassShardCursor];
        glassShardCursor = (glassShardCursor + 1) % GLASS_SHARD_MAX;
        s.alive = true; s.landed = false; s.age = 0; s.life = 2.6 + Math.random() * 2.4;
        s.pos.copy(tri.v[0]).addScaledVector(_gsA.subVectors(tri.v[1], tri.v[0]), u).addScaledVector(_gsB.subVectors(tri.v[2], tri.v[0]), w);
        const outward = _gsC.copy(s.pos).sub(burst || centre);
        if (outward.lengthSq() < 1e-6) outward.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        outward.normalize();
        if (burst) s.vel.copy(outward).multiplyScalar(5 + Math.random() * 7);
        else s.vel.copy(dir).multiplyScalar(1.2 + Math.random() * 3.2).addScaledVector(outward, 0.4 + Math.random() * 1.2);
        s.vel.x += (Math.random() - 0.5) * 2.4; s.vel.z += (Math.random() - 0.5) * 2.4; s.vel.y += Math.random() * 1.8;
        s.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
        s.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
        const k = baseSize * (0.5 + Math.random() * 0.9);
        s.size.set(k, k * (0.8 + Math.random() * 0.8), k);
        s.floorY = Math.min(s.pos.y - 0.05, 0.03);
    }
}

function updateGlassShards(dt) {
    if (!glassShardMesh) return;
    let any = false;
    for (let i = 0; i < GLASS_SHARD_MAX; i++) {
        const s = glassShardState[i];
        if (!s.alive) continue;
        any = true; s.age += dt;
        if (s.age >= s.life) {
            s.alive = false; _gsDummy.scale.setScalar(0); _gsDummy.updateMatrix();
            glassShardMesh.setMatrixAt(i, _gsDummy.matrix); continue;
        }
        if (!s.landed) {
            s.vel.y -= 14 * dt; s.pos.addScaledVector(s.vel, dt);
            s.rot.x += s.spin.x * dt; s.rot.y += s.spin.y * dt; s.rot.z += s.spin.z * dt;
            if (s.pos.y <= s.floorY) { s.pos.y = s.floorY + 0.01; s.landed = true; s.rot.x = Math.PI / 2; }
        }
        const fade = Math.min(1, (s.life - s.age) / 0.6);
        _gsDummy.position.copy(s.pos); _gsDummy.rotation.copy(s.rot); _gsDummy.scale.copy(s.size).multiplyScalar(fade);
        _gsDummy.updateMatrix(); glassShardMesh.setMatrixAt(i, _gsDummy.matrix);
    }
    if (any) glassShardMesh.instanceMatrix.needsUpdate = true;
}

function breakGlassPane(mesh, faceIndex, dir, burstCentre = null, silent = false) {
    const g = mesh.userData && mesh.userData.glass;
    if (!g || faceIndex === undefined || faceIndex === null) return false;
    const pid = g.paneOfTri[faceIndex];
    if (pid === undefined) return false;
    const pane = g.panes[pid];
    if (pane.broken) return false;
    pane.broken = true; g.alive--;
    spawnGlassShards(mesh, pane, dir || new THREE.Vector3(0, 0, 1), burstCentre);
    const index = mesh.geometry.index, arr = index.array;
    for (const t of pane.tris) { arr[t * 3] = arr[t * 3 + 1] = arr[t * 3 + 2] = 0; }
    index.needsUpdate = true;
    if (!silent) playGlassBreakSound(1);
    removeGlassMeshIfEmpty(mesh);
    return true;
}

function breakGlassInRadius(centre, radius) {
    let broken = 0; const world = new THREE.Vector3();
    collidableObjects.slice(1).forEach(mesh => {
        const g = mesh.userData && mesh.userData.glass;
        if (!g || g.alive === 0) return;
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        const bs = mesh.geometry.boundingSphere;
        world.copy(bs.center).applyMatrix4(mesh.matrixWorld);
        const sc = mesh.matrixWorld.getMaxScaleOnAxis();
        if (world.distanceTo(centre) > radius + bs.radius * sc) return;
        const idx = mesh.geometry.index.array, pos = mesh.geometry.attributes.position;
        for (let p = 0; p < g.panes.length; p++) {
            const pane = g.panes[p]; if (pane.broken) continue;
            const t = pane.tris[0]; world.set(0, 0, 0);
            for (let k = 0; k < 3; k++) world.add(_gsA.fromBufferAttribute(pos, idx[t * 3 + k]));
            world.divideScalar(3).applyMatrix4(mesh.matrixWorld);
            if (world.distanceTo(centre) <= radius) {
                if (breakGlassPane(mesh, t, null, centre, true)) broken++;
            }
        }
    });
    if (broken > 0) playGlassBreakSound(3);
    return broken;
}

const CUSTOM_MAP = { url: 'low_poly_city.glb', scale: 1.5, waypointSource: 'Texture_Strada', floorY: -0.5 };
const _stdMatCache = new Map();
function toStandardMapMaterial(mat) {
    if (!mat || !mat.isMeshPhysicalMaterial) return mat;
    if (!_stdMatCache.has(mat)) {
        const std = new THREE.MeshStandardMaterial({
            color: (mat.color.convertLinearToSRGB ? mat.color.clone().convertLinearToSRGB() : mat.color.clone()), map: mat.map,
            roughness: Math.max(0.55, mat.roughness), metalness: Math.min(0.2, mat.metalness), side: mat.side
        });
        if (std.map) std.map.encoding = THREE.LinearEncoding;
        std.name = mat.name;
        _stdMatCache.set(mat, std);
    }
    return _stdMatCache.get(mat);
}

function classifyMapMaterial(meshName, matName) {
    const n = (meshName || '').toLowerCase();
    if (matName === 'Vetro') return 'glass';
    if (matName === 'Tubes__0') return 'steel';
    if (/^(car|tire|camion|ruote|container|dumpster|oilbarrel|pole|bin|busstop|stop|fence)|sign/.test(n)) return 'steel';
    if (/tree|pine|cespugli|bush|vas[oi]|vase|bench|sdraio|persiane/.test(n)) return 'wood';
    if (/^(tend[ae])/.test(n)) return 'drywall';
    if (/^(casa|condominio)/.test(n)) return 'brick';
    return 'concrete';
}

function applyCustomMap(root) {
    const S = CUSTOM_MAP.scale;
    root.scale.setScalar(S); root.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(root);
    const c = all.getCenter(new THREE.Vector3());
    root.position.set(-c.x, 0, -c.z);
    root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(root);
    MAP_BOUNDS.minX = bb.min.x; MAP_BOUNDS.maxX = bb.max.x;
    MAP_BOUNDS.minZ = bb.min.z; MAP_BOUNDS.maxZ = bb.max.z;

    const w = bb.max.x - bb.min.x + 40, dpt = bb.max.z - bb.min.z + 40;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, dpt), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = CUSTOM_MAP.floorY; floor.visible = false;
    floor.userData = { materialType: 'concrete', penetrationResistance: MaterialResistance.concrete };
    scene.add(floor); collidableObjects.push(floor);

    const wallMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const addWall = (sx, sz, px, pz) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 60, sz), wallMat);
        m.position.set(px, 28, pz); m.visible = false;
        m.userData = { materialType: 'concrete', penetrationResistance: 99 };
        scene.add(m); collidableObjects.push(m);
    };
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    addWall(w, 2, cx, bb.min.z - 1); addWall(w, 2, cx, bb.max.z + 1);
    addWall(2, dpt, bb.min.x - 1, cz); addWall(2, dpt, bb.max.x + 1, cz);

    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1 });
    const roads = [];
    const tmpBox = new THREE.Box3(), tmpSize = new THREE.Vector3();
    const meshes = [];
    root.traverse(o => { if (o.isMesh) meshes.push(o); });
    meshes.forEach(o => {
        const origMat = Array.isArray(o.material) ? o.material[0] : o.material;
        const matName = origMat && origMat.name;
        const type = classifyMapMaterial(o.name, matName);
        if (type === 'glass') { o.material = glass; prepareBreakableGlass(o); } else o.material = toStandardMapMaterial(origMat);
        if (type !== 'glass' && matName !== 'Tubes__0' && /^Plane[\d.]*_/.test(o.name)) o.material = groundTileMaterial(o.material);
        tmpBox.setFromObject(o); tmpBox.getSize(tmpSize);
        o.userData = Object.assign(o.userData || {}, { materialType: type, penetrationResistance: MaterialResistance[type] ?? 1.65 });
        collidableObjects.push(o);
        if (matName === CUSTOM_MAP.waypointSource && tmpBox.max.y < 0.8) roads.push(tmpBox.getCenter(new THREE.Vector3()));
    });
    scene.add(root);
    root.traverse(o => { o.matrixAutoUpdate = false; });

    const wps = [], spawnCands = [];
    roads.forEach(p => {
        const pr = probeOpenSpace(p.x, p.z);
        if (pr.grounded && pr.minD >= 1.5) {
            wps.push(new THREE.Vector3(p.x, 0, p.z));
            if (pr.minD >= 3.0) spawnCands.push({ x: p.x, z: p.z, yaw: pr.bestAng + Math.PI, open: pr.bestD });
        }
    });
    if (wps.length < 4) throw new Error('map has no usable road tiles for waypoints (' + wps.length + ')');
    NUKETOWN_WAYPOINTS.length = 0; wps.forEach(v => NUKETOWN_WAYPOINTS.push(v));

    spawnCands.sort((a, b) => b.open - a.open);
    MAP_SPAWNS.length = 0;
    spawnCands.forEach(sp => {
        if (MAP_SPAWNS.length < 6 && MAP_SPAWNS.every(m => Math.hypot(m.pos.x - sp.x, m.pos.z - sp.z) > 25)) {
            MAP_SPAWNS.push({ pos: new THREE.Vector3(sp.x, 1.6, sp.z), yaw: sp.yaw });
        }
    });
    if (!MAP_SPAWNS.length) MAP_SPAWNS.push({ pos: new THREE.Vector3(wps[0].x, 1.6, wps[0].z), yaw: 0 });
    MAP_IS_CUSTOM = true;

    bots.forEach((b, i) => {
        const wp = NUKETOWN_WAYPOINTS[Math.floor(i * NUKETOWN_WAYPOINTS.length / bots.length)];
        b.mesh.position.copy(wp);
        b.waypoints = [wp.clone(), b.getRandomTarget(), b.getRandomTarget()];
        b.currentWaypointIndex = 0;
    });
    const sp0 = MAP_SPAWNS[0];
    yawObject.position.copy(sp0.pos);
    baseYaw = sp0.yaw; basePitch = 0;
    yawObject.rotation.y = sp0.yaw;
}

function initMap() {
    const btn = document.getElementById('btn-play');
    const label = btn ? btn.innerText : 'DEPLOY';
    const setBtn = (t, dis) => { if (btn) { btn.innerText = t; btn.disabled = dis; } };
    const fallback = (why) => {
        console.warn('[map] ' + why + ' - using the built-in Nuketown map.');
        buildNuketownMap(); mapReady = true; setBtn(label, false);
    };
    if (!THREE.GLTFLoader) { fallback('GLTFLoader missing'); return; }
    setBtn('LOADING MAP... 0%', true);
    new THREE.GLTFLoader().load(CUSTOM_MAP.url, (gltf) => {
        try {
            applyCustomMap(gltf.scene);
            mapReady = true; setBtn(label, false);
        } catch (err) {
            console.error(err);
            scene.remove(gltf.scene);
            collidableObjects.length = 0;
            fallback('map setup failed');
        }
    }, (xhr) => {
        if (xhr && xhr.lengthComputable) setBtn('LOADING MAP... ' + Math.round(100 * xhr.loaded / xhr.total) + '%', true);
    }, () => fallback('could not load ' + CUSTOM_MAP.url));
}
initMap();

/* --- Weapon Construction, Muzzle Flash & Optics --- */
const gunGroup = new THREE.Group();
camera.add(gunGroup);

function buildSleekMuzzleFlash(muzzleY, muzzleZ) {
    const muzzleFlashGroup = new THREE.Group();
    muzzleFlashGroup.name = 'muzzleFlash';
    muzzleFlashGroup.position.set(0, muzzleY, muzzleZ - 0.04);
    muzzleFlashGroup.visible = false;
    const spikeMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.065, 5), spikeMat);
        spike.rotation.z = angle;
        spike.position.set(Math.cos(angle + Math.PI / 2) * 0.028, Math.sin(angle + Math.PI / 2) * 0.028, -0.02);
        muzzleFlashGroup.add(spike);
    }
    const forwardJet = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.09, 6), coreMat);
    forwardJet.rotation.x = -Math.PI / 2;
    forwardJet.position.set(0, 0, -0.045);
    muzzleFlashGroup.add(forwardJet);
    const fLight = new THREE.PointLight(0xffaa33, 0, 3.5, 2.0);
    fLight.name = 'muzzleLight';
    muzzleFlashGroup.add(fLight);
    return muzzleFlashGroup;
}

const MUZZLE_MODEL_DIR = '';
const MUZZLE_GLB = {
    m4a1: { suppressor: { file: '556_silence.glb',      length: 0.23,  y: 0, overlap: 0.015 },
            brake:      { file: '556_muzzle_brake.glb', length: 0.11,  y: 0, overlap: 0.010 } },
    mp5:  { suppressor: { file: 'smg_silence.glb',      length: 0.235, y: 0, overlap: 0.020 },
            brake:      { file: 'smg_muzzle_brake.glb', length: 0.10,  y: 0, overlap: 0.010 } },
    AWP:  { suppressor: { file: 'ak_silence.glb',       length: 0.26,  y: 0, overlap: 0.020 },
            brake:      { file: 'ak_muzzle_brake.glb',  length: 0.12,  y: 0, overlap: 0.010 } }
};
const MUZZLE_AXIS = { m4a1: { x: 0, y: -0.0057 }, mp5: null, AWP: null };
const _muzzleAxisCache = {};
const muzzleTemplates = {};
const muzzleDeviceMat = new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.38, metalness: 0.85, side: THREE.DoubleSide });
function buildMuzzleTemplate(gltfScene, cfg) {
    // The models are authored pointing along +X (rear cap at low X, bore end at high X).
    gltfScene.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(gltfScene);
    const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    gltfScene.traverse(o => { if (o.isMesh) { o.material = muzzleDeviceMat; o.castShadow = false; o.receiveShadow = false; } });
    // pivot at the rear-centre of the device, +X forward
    const inner = new THREE.Group();
    inner.add(gltfScene);
    gltfScene.position.set(-bb.min.x, -c.y, -c.z);
    // +X -> -Z (the gun's forward), then scale to the requested length
    const rot = new THREE.Group();
    rot.rotation.y = Math.PI / 2;
    rot.add(inner);
    const root = new THREE.Group();
    root.scale.setScalar(cfg.length / size.x);
    root.add(rot);
    root.userData.length = cfg.length;
    return root;
}
function loadMuzzleModels() {
    if (!THREE.GLTFLoader) { console.warn('[muzzle] GLTFLoader missing - using procedural muzzle devices'); return; }
    const loader = new THREE.GLTFLoader();
    Object.keys(MUZZLE_GLB).forEach(gun => Object.keys(MUZZLE_GLB[gun]).forEach(type => {
        const cfg = MUZZLE_GLB[gun][type];
        loader.load(MUZZLE_MODEL_DIR + cfg.file, (gltf) => {
            try {
                muzzleTemplates[gun + '/' + type] = buildMuzzleTemplate(gltf.scene, cfg);
                // refresh the gun in hand / loadout preview if it is showing this very device
                if (loadouts[gun] && loadouts[gun].muzzle === type) {
                    if (gun === currentWeaponKey) rebuildWeaponMesh();
                    if (typeof updateLoadoutViewer === 'function') updateLoadoutViewer();
                }
            } catch (e) { console.warn('[muzzle] could not process ' + cfg.file, e); }
        }, undefined, () => console.warn('[muzzle] could not load ' + MUZZLE_MODEL_DIR + cfg.file + ' - using the procedural ' + type));
    }));
}
function measureBarrelAxis(group, barrelTipZ) {
    group.updateMatrixWorld(true);
    const xs = [], ys = [], v = new THREE.Vector3();
    (function walk(o) {
        if (!o.visible) return;
        if (o.isMesh && o.geometry && o.geometry.attributes.position) {
            const pos = o.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
                if (v.z <= barrelTipZ + 0.07 && v.z >= barrelTipZ - 0.03 && Math.abs(v.x) < 0.05 && v.y > -0.10 && v.y < 0.12) { xs.push(v.x); ys.push(v.y); }
            }
        }
        o.children.forEach(walk);
    })(group);
    if (ys.length < 12) return null;
    const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    return { x: med(xs), y: med(ys) };
}
function makeMuzzleGlb(gunType, type, barrelTipZ, gunGroup) {
    const tpl = muzzleTemplates[gunType + '/' + type];
    if (!tpl) return null;
    const cfg = MUZZLE_GLB[gunType] && MUZZLE_GLB[gunType][type];
    if (!cfg) return null;
    let axis = MUZZLE_AXIS[gunType];
    if (!axis) {
        const key = gunType + '|' + barrelTipZ;
        if (_muzzleAxisCache[key] === undefined) {
            _muzzleAxisCache[key] = measureBarrelAxis(gunGroup, barrelTipZ);
            console.log('[muzzle] ' + gunType + ' barrel axis measured from the model: ' + (_muzzleAxisCache[key]
                ? 'x=' + _muzzleAxisCache[key].x.toFixed(4) + ' y=' + _muzzleAxisCache[key].y.toFixed(4)
                : 'not found, using y=0.02 (set MUZZLE_AXIS.' + gunType + ' by hand if it looks off)'));
        }
        axis = _muzzleAxisCache[key] || { x: 0, y: 0.02 };
    }
    const dev = tpl.clone(true);
    dev.name = 'muzzleDevice';
    dev.position.set(axis.x, axis.y + (cfg.y || 0), barrelTipZ + (cfg.overlap || 0));
    dev.userData.axisY = axis.y + (cfg.y || 0);
    return dev;
}

/* Where the underbarrel grip hangs, per weapon (game units, gun space).
   y = height of the rail the grip hangs from, z = centre of the grip's mounting plate (more negative = closer to the muzzle).
   Weapons not listed use the default (y -0.065, z -0.36). Nudge these numbers to fine-tune a gun. */
const GRIP_ANCHOR = {
    m4a1: { y: -0.046, z: -0.300 },  // under the front third of the handguard
    AWP:  { y:  0.013, z: -0.464 },  // under the chassis forend
    svd:  { y:  0.030, z: -0.557 },  // under the wooden handguard
    m249: { y: -0.061, z: -0.466 },  // under the lower handguard, ahead of the feed tray
    toz34:     { y:  0.026, z: -0.490 }, // under the wooden forend, towards its front
    benellim4: { y: -0.003, z: -0.500 }, // under the pump forend (the skeleton grip's plate is wide, so keep it well inside the forend)
    mp5:       { y:  0.007, z: -0.485 }  // hangs from the underside of the barrel sleeve, ahead of the handguard and magwell
};

function createProceduralWeapon(gunType = currentWeaponKey, loadout = currentLoadout) {
    if (WEAPONS[gunType] && WEAPONS[gunType].type === 'MELEE' && typeof buildMeleeMesh === 'function') return buildMeleeMesh(gunType);
    // pistols (and the Uzi) cannot take stocks or underbarrel grips
    if (WEAPONS[gunType] && WEAPONS[gunType].type === 'SECONDARY') loadout = Object.assign({}, loadout, { stock: 'standard', handle: 'none' });
    const group = new THREE.Group();
    const gunmetalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.7 });
    const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.85 });
    const polymerMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.2 });
    const factionMat = new THREE.MeshStandardMaterial({ color: WEAPONS[gunType]?.color || 0x38bdf8, metalness: 0.8, roughness: 0.35 });

    let barrelTipZ = -0.75; let railCenterZ = -0.06; let railY = 0.08;
    let stockStartZ = 0.30; let magY = -0.12; let magZ = -0.08;
    let handleY = -0.065; let handleZ = -0.36;

    const WEAPON_DIMS = {
        m4a1:      { barrelTipZ: loadout.muzzle === 'none' ? -0.67 : -0.63, railCenterZ: 0.0,   railY: loadout.scope !== 'iron' ? 0.05 : 0.104, adsY: M4A1_IRON_AIM_Y,      adsX: M4A1_ADS_X,      adsZ: M4A1_ADS_Z },
        AWP:       { barrelTipZ: -1.10, railCenterZ: -0.10, railY: 0.095, adsY: AWP_IRON_AIM_Y,       adsX: AWP_ADS_X,       adsZ: AWP_ADS_Z },
        mp5:       { barrelTipZ: -0.56, railCenterZ: -0.05, railY: 0.085, adsY: MP5_IRON_AIM_Y,       adsX: MP5_ADS_X,       adsZ: MP5_ADS_Z },
        svd:       { barrelTipZ: -1.05, railCenterZ: -0.06, railY: 0.095, adsY: SVD_IRON_AIM_Y,       adsX: SVD_ADS_X,       adsZ: SVD_ADS_Z },
        toz34:     { barrelTipZ: -0.95, railCenterZ: -0.10, railY: 0.085, adsY: TOZ34_IRON_AIM_Y,     adsX: TOZ34_ADS_X,     adsZ: TOZ34_ADS_Z },
        benellim4: { barrelTipZ: -0.88, railCenterZ: -0.08, railY: 0.090, adsY: BENELLIM4_IRON_AIM_Y, adsX: BENELLIM4_ADS_X, adsZ: BENELLIM4_ADS_Z },
        g17:       { barrelTipZ: -0.32, railCenterZ: -0.12, railY: 0.075, adsY: G17_IRON_AIM_Y,       adsX: G17_ADS_X,       adsZ: G17_ADS_Z },
        m249:      { barrelTipZ: -0.88, railCenterZ: -0.08, railY: 0.105, adsY: M249_IRON_AIM_Y,      adsX: M249_ADS_X,      adsZ: M249_ADS_Z },
        uzi:       { barrelTipZ: -0.42, railCenterZ: -0.12, railY: 0.085, adsY: UZI_IRON_AIM_Y,       adsX: UZI_ADS_X,       adsZ: UZI_ADS_Z }
    };

    const dims = WEAPON_DIMS[gunType] || WEAPON_DIMS.m4a1;
    if (GRIP_ANCHOR[gunType]) { handleY = GRIP_ANCHOR[gunType].y; handleZ = GRIP_ANCHOR[gunType].z; }
    const useGlb = typeof buildAnyWeaponGlb === 'function' && hasGlbTemplate(gunType);
    let glbBuild = null;

    if (useGlb) {
        glbBuild = buildAnyWeaponGlb(gunType, loadout);
        barrelTipZ = dims.barrelTipZ;
        railCenterZ = dims.railCenterZ;
        railY = dims.railY;
        group.add(glbBuild.node);
    } else {
        barrelTipZ = dims.barrelTipZ;
        railCenterZ = dims.railCenterZ;
        railY = dims.railY;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.55), gunmetalMat);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.40, 12), darkSteelMat);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.45);
        group.add(body, barrel);
    }

    const muzzleType = loadout.muzzle || 'none';
    const glbMuzzle = (typeof makeMuzzleGlb === 'function' && (muzzleType === 'suppressor' || muzzleType === 'brake')) ? makeMuzzleGlb(gunType, muzzleType, barrelTipZ, group) : null;
    if (glbMuzzle) {
        group.add(glbMuzzle);
    } else if (muzzleType === 'suppressor') {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.28, 14), darkSteelMat);
        can.rotation.x = Math.PI / 2; can.position.set(0, 0.02, barrelTipZ - 0.14); group.add(can);
    } else if (muzzleType === 'compensator') {
        const comp = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.10), factionMat);
        comp.position.set(0, 0.02, barrelTipZ - 0.05); group.add(comp);
    } else if (muzzleType === 'brake') {
        const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.12, 8), darkSteelMat);
        brake.rotation.x = Math.PI / 2; brake.position.set(0, 0.02, barrelTipZ - 0.06); group.add(brake);
    } else if (!useGlb) {
        const hider = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.018, 0.06, 8), darkSteelMat);
        hider.rotation.x = Math.PI / 2; hider.position.set(0, 0.02, barrelTipZ - 0.03); group.add(hider);
    }

    const scopeType = loadout.scope || 'iron';
    const opticGroup = new THREE.Group(); opticGroup.name = 'optic';
    group.userData.adsAimY = railY + (scopeType === 'iron' ? 0.06 : 0.055);
    group.userData.scopeType = scopeType;
    group.userData.muzzleZ = barrelTipZ - (glbMuzzle ? glbMuzzle.userData.length : (loadout.muzzle && loadout.muzzle !== 'none' ? 0.14 : 0));
    group.userData.muzzleY = glbMuzzle ? glbMuzzle.userData.axisY : 0.02;

    if (useGlb) {
        if (scopeType === 'iron') group.userData.adsAimY = dims.adsY;
        group.userData.adsX = dims.adsX;
        group.userData.adsZ = dims.adsZ;
    }

    if (scopeType === 'reddot' || scopeType === 'acog' || scopeType === 'sniper') {
        const useBuiltInScope = scopeType === 'sniper' && glbBuild && glbBuild.anim.hasScope;
        if (!useBuiltInScope) {
            const scopeBuild = buildScopeGlb(scopeType, railY, railCenterZ);
            if (scopeBuild) { opticGroup.add(scopeBuild.node); group.userData.adsAimY = scopeBuild.aimY; }
        }
    } else if (!useGlb) {
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
    } else if (!useGlb) {
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
    } else if (!useGlb) {
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.22, 0.085), polymerMat);
        mag.position.set(0, magY, magZ); mag.rotation.x = 0.2; magGroup.add(mag);
    }
    group.add(magGroup);

    const handleType = loadout.handle || 'none';
    if (!GRIP_ANCHOR[gunType]) handleZ = Math.max(handleZ, barrelTipZ + 0.18); // short guns (pistols, Uzi): keep the grip under the slide, not floating past the muzzle (guns with an explicit GRIP_ANCHOR are trusted as-is)
    // some models carry their own grip mesh (MP5 stubby): when that one is showing, don't add a second one
    const builtInGrip = glbBuild && glbBuild.node.userData.builtInGrip;
    const gripGlb = (typeof buildGripGlb === 'function' && handleType !== 'none' && handleType !== builtInGrip) ? buildGripGlb(handleType, handleY, handleZ) : null;
    const gripFallback = { skeleton: 'angled', folding: 'vertical' }[handleType] || handleType; // used only if a grip .glb is missing
    if (handleType !== 'none' && handleType === builtInGrip) {
        /* the model's own grip is already visible */
    } else if (gripGlb) {
        group.add(gripGlb);
    } else if (gripFallback === 'vertical') {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, 0.16, 10), darkSteelMat);
        grip.position.set(0, handleY - 0.08, handleZ); group.add(grip);
    } else if (gripFallback === 'angled') {
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.15), factionMat);
        grip.position.set(0, handleY - 0.03, handleZ); grip.rotation.x = -0.4; group.add(grip);
    } else if (gripFallback === 'stubby') {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.09, 10), polymerMat);
        grip.position.set(0, handleY - 0.045, handleZ); group.add(grip);
    } else if (!useGlb) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.20), darkSteelMat);
        rail.position.set(0, handleY, handleZ); group.add(rail);
    }

    group.add(buildSleekMuzzleFlash(group.userData.muzzleY, group.userData.muzzleZ));

    if (glbBuild) { weaponAnim = glbBuild.anim; weaponAnim.procMag = weaponAnim.glbMag ? null : magGroup; }
    return group;
}

function rebuildWeaponMesh() {
    weaponAnim = null; gunGroup.clear();
    customGunMesh = createProceduralWeapon(currentWeaponKey, currentLoadout);
    gunGroup.add(customGunMesh);
}
rebuildWeaponMesh();
if (typeof loadMuzzleModels === 'function') loadMuzzleModels();
gunGroup.position.set(0.2, -0.22, -0.4);

/* --- Combat Feedback --- */
let muzzleFlashTimer = 0; const MUZZLE_FLASH_DURATION = 0.035;
const MAX_DECALS = 48; let decalIndex = 0; const decalPool = [];
const MAX_SPARKS = 64; let sparkIndex = 0; const sparkPool = [];

(function initFeedbackPools() {
    const decalGeo = new THREE.CircleGeometry(0.042, 10);
    const decalMat = new THREE.MeshBasicMaterial({ color: 0x090b10, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
    for (let i = 0; i < MAX_DECALS; i++) {
        const m = new THREE.Mesh(decalGeo, decalMat); m.visible = false; scene.add(m); decalPool.push(m);
    }
    const sparkGeo = new THREE.BoxGeometry(0.018, 0.018, 0.09);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd966, blending: THREE.AdditiveBlending });
    for (let i = 0; i < MAX_SPARKS; i++) {
        const m = new THREE.Mesh(sparkGeo, sparkMat); m.visible = false; scene.add(m);
        sparkPool.push({ mesh: m, alive: false, age: 0, maxLife: 0.25, velocity: new THREE.Vector3() });
    }
})();

function triggerMuzzleFlash() {
    if (!customGunMesh || currentLoadout.muzzle === 'suppressor') return;
    const mf = customGunMesh.getObjectByName('muzzleFlash'); if (!mf) return;
    muzzleFlashTimer = MUZZLE_FLASH_DURATION; mf.visible = true; mf.rotation.z = Math.random() * Math.PI * 2;
    const baseScale = isADS ? 0.18 : (0.75 + Math.random() * 0.3); mf.scale.setScalar(baseScale);
    mf.position.y = (customGunMesh.userData.muzzleY ?? 0.02) - (isADS ? 0.022 : 0);
    const l = mf.getObjectByName('muzzleLight'); if (l) l.intensity = isADS ? 0.8 : 3.2;
}

function triggerImpactVFX(point, normal) {
    const decal = decalPool[decalIndex]; decalIndex = (decalIndex + 1) % MAX_DECALS;
    decal.position.copy(point).addScaledVector(normal, 0.005); decal.lookAt(point.clone().add(normal)); decal.visible = true;
    const tangent = new THREE.Vector3(normal.y, -normal.x, normal.z);
    if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0); tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    for (let i = 0; i < 6; i++) {
        const sp = sparkPool[sparkIndex]; sparkIndex = (sparkIndex + 1) % MAX_SPARKS;
        sp.alive = true; sp.age = 0; sp.maxLife = 0.16 + Math.random() * 0.14;
        sp.mesh.position.copy(point).addScaledVector(normal, 0.02); sp.mesh.visible = true;
        const sA = (Math.random() - 0.5) * 1.4, sB = (Math.random() - 0.5) * 1.4, spd = 5.5 + Math.random() * 7.5;
        sp.velocity.copy(normal).addScaledVector(tangent, sA).addScaledVector(bitangent, sB).normalize().multiplyScalar(spd);
    }
}

function updateFeedbackPools(dt) {
    if (muzzleFlashTimer > 0) {
        muzzleFlashTimer -= dt;
        const mf = customGunMesh && customGunMesh.getObjectByName('muzzleFlash');
        if (mf) {
            const l = mf.getObjectByName('muzzleLight');
            if (muzzleFlashTimer <= 0) { mf.visible = false; if (l) l.intensity = 0; }
            else if (l) { l.intensity = (isADS ? 0.8 : 3.2) * (muzzleFlashTimer / MUZZLE_FLASH_DURATION); }
        }
    }
    for (let i = 0; i < MAX_SPARKS; i++) {
        const sp = sparkPool[i]; if (!sp.alive) continue;
        sp.age += dt;
        if (sp.age >= sp.maxLife) { sp.alive = false; sp.mesh.visible = false; continue; }
        sp.velocity.y -= 18.0 * dt; sp.mesh.position.addScaledVector(sp.velocity, dt);
        sp.mesh.lookAt(sp.mesh.position.clone().add(sp.velocity));
    }
}

function playMechanicalClick(pitchHz = 820) {
    try {
        if (typeof audioCtx !== 'undefined' && audioCtx) {
            const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
            osc.type = 'square'; osc.frequency.setValueAtTime(pitchHz, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.10 * (gameSettings.volume ?? 1), audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.022);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.025);
        }
    } catch (e) {}
}

/* --- Ballistics --- */
const MAX_PENETRATIONS_PER_FRAME = 4;
const activeProjectiles = [];
const ballisticsRay = new THREE.Raycaster();
const exitRay = new THREE.Raycaster();

function probeExitSurface(hitObject, entryPoint, rayDir, maxThickness) {
    const probeDist = maxThickness + 0.04;
    const probeOrigin = entryPoint.clone().addScaledVector(rayDir, probeDist);
    exitRay.set(probeOrigin, rayDir.clone().negate());
    exitRay.near = 0; exitRay.far = probeDist;
    const exitHits = exitRay.intersectObject(hitObject, false);
    if (exitHits.length === 0) return null;
    const exitHit = exitHits[exitHits.length - 1];
    const thickness = entryPoint.distanceTo(exitHit.point);
    if (thickness <= 0.0005 || thickness > maxThickness) return null;
    const exitNormal = exitHit.face ? exitHit.face.normal.clone().transformDirection(hitObject.matrixWorld).normalize() : rayDir.clone();
    return { exitPoint: exitHit.point, exitNormal, thickness };
}

function spawnBallisticProjectile({ origin, direction, weapon, colorHex }) {
    const vel = direction.clone().normalize().multiplyScalar(weapon.muzzleVelocity || 320);
    const trailAssets = typeof getTracerAssets === 'function' ? getTracerAssets(colorHex) : { geo: { trail: new THREE.CylinderGeometry(0.01,0.01,1), head: new THREE.BoxGeometry() }, trailMat: new THREE.MeshBasicMaterial(), headMat: new THREE.MeshBasicMaterial() };
    const group = new THREE.Group();
    const trail = new THREE.Mesh(trailAssets.geo.trail, trailAssets.trailMat); trail.frustumCulled = false; trail.scale.z = 0.001;
    const head = new THREE.Mesh(trailAssets.geo.head, trailAssets.headMat); head.frustumCulled = false; head.scale.z = 0.001;
    group.add(trail, head); group.position.copy(origin); group.lookAt(origin.clone().add(direction));
    scene.add(group);
    activeProjectiles.push({
        origin: origin.clone(), position: origin.clone(), velocity: vel, gravity: new THREE.Vector3(0, -9.81, 0),
        age: 0, maxLifetime: 3.5, distanceTraveled: 0, penetrationCount: 0,
        initialPenetration: weapon.penetrationDepth || 1.35, remainingPenetration: weapon.penetrationDepth || 1.35,
        damageScale: 1.0, damage0: weapon.damage, damage1: weapon.damage1 || Math.round(weapon.damage * 0.65),
        range0: weapon.range0 || 30, range1: weapon.range1 || 105, group, trail, head
    });
}

function computeBallisticDamage(proj, dist, hitZone) {
    let base;
    if (dist <= proj.range0) base = proj.damage0;
    else if (dist >= proj.range1) base = proj.damage1;
    else { const t = (dist - proj.range0) / Math.max(0.001, proj.range1 - proj.range0); base = THREE.MathUtils.lerp(proj.damage0, proj.damage1, t); }
    const zoneMult = hitZone === 'head' ? 2.1 : (hitZone === 'torso' ? 1.0 : 0.85);
    return Math.max(1, Math.round(base * zoneMult * proj.damageScale));
}

function updateBallistics(dt) {
    if (dt <= 0) return;
    const halfDtSq = 0.5 * dt * dt;
    const botParts = []; bots.forEach(b => { if (b.state !== 'RAGDOLL') b.ragdollLinks.forEach(l => botParts.push(l.mesh)); });
    const allTargets = [...collidableObjects, ...botParts];

    for (let i = activeProjectiles.length - 1; i >= 0; i--) {
        const proj = activeProjectiles[i];
        proj.age += dt;
        if (proj.age >= proj.maxLifetime) { scene.remove(proj.group); activeProjectiles.splice(i, 1); continue; }

        const newPos = proj.position.clone().addScaledVector(proj.velocity, dt).addScaledVector(proj.gravity, halfDtSq);
        let segStart = proj.position.clone();
        let destroyed = false;

        for (let pen = 0; pen < MAX_PENETRATIONS_PER_FRAME; pen++) {
            const disp = new THREE.Vector3().subVectors(newPos, segStart);
            const remDist = disp.length();
            if (remDist <= 1e-5) break;
            const rayDir = disp.clone().divideScalar(remDist);

            ballisticsRay.set(segStart, rayDir); ballisticsRay.near = 0; ballisticsRay.far = remDist;
            const hits = ballisticsRay.intersectObjects(allTargets, false);
            if (hits.length === 0) break;

            const hit = hits[0], hitObj = hit.object, entryPt = hit.point.clone();
            const entryNorm = hit.face ? hit.face.normal.clone().transformDirection(hitObj.matrixWorld).normalize() : rayDir.clone().negate();
            const totalDist = proj.origin.distanceTo(entryPt);
            const hitZone = hitObj.userData?.hitZone || 'surface';
            const dmg = computeBallisticDamage(proj, totalDist, hitZone);

            if (hitObj.userData?.glass !== undefined) {
                if (typeof breakGlassPane === 'function') breakGlassPane(hitObj, hit.faceIndex, rayDir);
                proj.penetrationCount++; proj.damageScale *= 0.92; proj.remainingPenetration -= 0.04;
                segStart.copy(entryPt).addScaledVector(rayDir, 0.02); continue;
            }

            triggerImpactVFX(entryPt, entryNorm);
            if (hitObj.userData?.botRef) hitObj.userData.botRef.takeDamage(dmg, hitZone === 'head', entryPt, hitObj.userData.partName, proj.velocity, proj.penetrationCount > 0);

            const matType = hitObj.userData?.materialType || 'concrete';
            const resistance = hitObj.userData?.penetrationResistance ?? MaterialResistance[matType] ?? 1.65;
            if (resistance <= 0 || proj.remainingPenetration <= 0.02) { destroyed = true; break; }

            const maxThick = proj.remainingPenetration / resistance;
            const exitData = probeExitSurface(hitObj, entryPt, rayDir, maxThick);
            if (!exitData) { destroyed = true; break; }

            const cost = exitData.thickness * resistance;
            if (cost >= proj.remainingPenetration) { destroyed = true; break; }

            proj.remainingPenetration -= cost; proj.penetrationCount++;
            const retention = Math.max(0.25, 1.0 - (cost / proj.initialPenetration) * 0.6);
            proj.damageScale *= retention; proj.velocity.multiplyScalar(retention);
            triggerImpactVFX(exitData.exitPoint, exitData.exitNormal);
            segStart.copy(exitData.exitPoint).addScaledVector(rayDir, 0.01);
        }

        if (destroyed) { scene.remove(proj.group); activeProjectiles.splice(i, 1); continue; }
        const stepDist = proj.position.distanceTo(newPos);
        proj.position.copy(newPos); proj.velocity.addScaledVector(proj.gravity, dt); proj.distanceTraveled += stepDist;
        const dirNorm = proj.velocity.clone().normalize();
        proj.group.position.copy(proj.position); proj.group.lookAt(proj.position.clone().add(dirNorm));
        const trailLen = Math.min(3.5, proj.distanceTraveled);
        proj.trail.scale.z = Math.max(0.01, trailLen); proj.head.scale.z = 0.5;
    }
}

/* --- Bots --- */
class Bot {
    constructor(name, startPos) {
        this.name = name; this.kills = 0; this.deaths = 0; this.score = 0; this.maxHealth = 100; this.health = 100;
        this.state = 'PATROL'; this.mesh = new THREE.Group(); this.parts = {}; this.ragdollLinks = [];
        this.waypoints = [startPos.clone(), this.getRandomTarget(), this.getRandomTarget()];
        this.currentWaypointIndex = 0; this.patrolSpeed = 4.6; this.strafeSpeed = 5.8;
        this.walkCycle = Math.random() * Math.PI * 2; this.alertTimer = 0; this.strafeDirSign = 1;
        this.strafeSwitchTimer = 0; this.respawnTimer = 0; this.lastShotTime = 0;
        this.buildMesh(); this.mesh.position.copy(startPos); scene.add(this.mesh);
    }
    buildMesh() {
        this.mesh.clear(); this.parts = {}; this.ragdollLinks = [];
        const headMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.4 });
        const visorMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        const torsoMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
        const limbMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 });
        const createPart = (partName, geo, mat, hitZone, localOffset, pivotY = 0) => {
            const g = geo.clone(); if (pivotY !== 0) g.translate(0, pivotY, 0);
            const m = new THREE.Mesh(g, mat); m.position.copy(localOffset);
            m.userData = { botRef: this, partName, hitZone, isHead: hitZone === 'head', materialType: 'flesh', penetrationResistance: 0.45 };
            this.mesh.add(m); this.parts[partName] = m;
            this.ragdollLinks.push({ name: partName, mesh: m, defaultLocalPos: localOffset.clone(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
            return m;
        };
        createPart('torso', new THREE.BoxGeometry(0.48, 0.64, 0.28), torsoMat, 'torso', new THREE.Vector3(0, 1.08, 0));
        const headMesh = createPart('head', new THREE.BoxGeometry(0.32, 0.32, 0.32), headMat, 'head', new THREE.Vector3(0, 1.58, 0));
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.05), visorMat); visor.position.set(0, 0.02, 0.15); headMesh.add(visor);
        createPart('leftArm', new THREE.BoxGeometry(0.15, 0.56, 0.15), limbMat, 'limbs', new THREE.Vector3(-0.34, 1.34, 0), -0.22);
        createPart('rightArm', new THREE.BoxGeometry(0.15, 0.56, 0.15), limbMat, 'limbs', new THREE.Vector3(0.34, 1.34, 0), -0.22);
        createPart('leftLeg', new THREE.BoxGeometry(0.18, 0.75, 0.19), limbMat, 'limbs', new THREE.Vector3(-0.14, 0.75, 0), -0.375);
        createPart('rightLeg', new THREE.BoxGeometry(0.18, 0.75, 0.19), limbMat, 'limbs', new THREE.Vector3(0.14, 0.75, 0), -0.375);
        this.hpGroup = new THREE.Group(); this.hpGroup.position.set(0, 1.98, 0);
        const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.08), new THREE.MeshBasicMaterial({ color: 0x0f172a, side: THREE.DoubleSide }));
        this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.06), new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide }));
        this.hpFill.position.z = 0.002; this.hpGroup.add(hpBg, this.hpFill); this.mesh.add(this.hpGroup);
    }
    getRandomTarget() {
        let pool = NUKETOWN_WAYPOINTS;
        if (MAP_IS_CUSTOM && this.mesh) {
            const near = pool.filter(w => w.distanceTo(this.mesh.position) < 45);
            if (near.length > 1) pool = near;
        }
        const pick = pool[Math.floor(Math.random() * pool.length)];
        return pick.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
    }
    update(delta, playerPos) {
        const dt = Math.min(delta, 0.05);
        if (this.hpGroup.visible) this.hpGroup.lookAt(playerPos.x, this.mesh.position.y + 1.98, playerPos.z);
        if (this.state === 'RAGDOLL') {
            this.respawnTimer -= dt; if (this.respawnTimer <= 0) { this.respawn(); return; }
            for (const link of this.ragdollLinks) {
                link.velocity.y -= 21.0 * dt; link.mesh.position.addScaledVector(link.velocity, dt);
                link.mesh.rotation.x += link.angularVelocity.x * dt; link.mesh.rotation.y += link.angularVelocity.y * dt; link.mesh.rotation.z += link.angularVelocity.z * dt;
                if (link.mesh.position.y < 0.14) {
                    link.mesh.position.y = 0.14; if (link.velocity.y < 0) link.velocity.y = -link.velocity.y * 0.32;
                    const damp = Math.max(0, 1 - 6.5 * dt); link.velocity.x *= damp; link.velocity.z *= damp; link.angularVelocity.multiplyScalar(damp);
                }
            } return;
        }
        let moveSpeed = 0; const distToPlayer = this.mesh.position.distanceTo(playerPos);
        if (this.state === 'PATROL') {
            const wp = this.waypoints[this.currentWaypointIndex];
            const toWP = new THREE.Vector3().subVectors(wp, this.mesh.position); toWP.y = 0; const d = toWP.length();
            if (d < 1.2) { this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length; this.waypoints[this.currentWaypointIndex] = this.getRandomTarget(); }
            else { toWP.divideScalar(d); this.mesh.position.addScaledVector(toWP, this.patrolSpeed * dt); this.mesh.rotation.y = Math.atan2(toWP.x, toWP.z); moveSpeed = this.patrolSpeed; }
            if (distToPlayer < 26) { this.state = 'ALERT_STRAFE'; this.alertTimer = 5.0; }
        } else if (this.state === 'ALERT_STRAFE') {
            this.alertTimer -= dt; this.strafeSwitchTimer -= dt;
            if (this.strafeSwitchTimer <= 0) { this.strafeDirSign *= -1; this.strafeSwitchTimer = 0.65 + Math.random() * 0.65; }
            const toPlayer = new THREE.Vector3().subVectors(playerPos, this.mesh.position); toPlayer.y = 0;
            if (toPlayer.lengthSq() > 0.001) {
                toPlayer.normalize(); this.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
                const strafeDir = new THREE.Vector3(-toPlayer.z * this.strafeDirSign, 0, toPlayer.x * this.strafeDirSign);
                this.mesh.position.addScaledVector(strafeDir, this.strafeSpeed * dt); moveSpeed = this.strafeSpeed;
            }
            if (this.alertTimer <= 0 && distToPlayer > 30) this.state = 'PATROL';
        }
        this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, MAP_BOUNDS.minX + 1, MAP_BOUNDS.maxX - 1);
        this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, MAP_BOUNDS.minZ + 1, MAP_BOUNDS.maxZ - 1);
        if (moveSpeed > 0.1) {
            this.walkCycle += dt * moveSpeed * 2.4; const swing = Math.sin(this.walkCycle) * 0.62;
            this.parts.leftLeg.rotation.x = swing; this.parts.rightLeg.rotation.x = -swing;
            this.parts.leftArm.rotation.x = -swing * 0.75; this.parts.rightArm.rotation.x = swing * 0.75;
        } else {
            this.parts.leftLeg.rotation.x = 0; this.parts.rightLeg.rotation.x = 0;
            this.parts.leftArm.rotation.x = 0; this.parts.rightArm.rotation.x = 0;
        }
        if (distToPlayer < 32) {
            const now = performance.now();
            if (now - this.lastShotTime > 1250) { this.shootAtPlayer(playerPos); this.lastShotTime = now; }
        }
    }
    shootAtPlayer(playerPos) {
        if (typeof playGunshotSound === 'function') playGunshotSound('mp5');
        createLaserBeam(this.mesh.position.clone().add(new THREE.Vector3(0, 1.45, 0)), playerPos, 0xf97316);
        if (Math.random() < 0.28) damagePlayer(10, this);
    }
    takeDamage(amount, isHeadshot = false, hitPoint = null, struckPartName = 'torso', impactVel = null, isWallbang = false) {
        if (this.state === 'RAGDOLL') return;
        this.health = Math.max(0, this.health - amount);
        const hpRatio = this.health / this.maxHealth;
        this.hpFill.scale.x = Math.max(0.001, hpRatio); this.hpFill.position.x = -0.32 * (1 - hpRatio);
        this.hpFill.material.color.setHex(hpRatio > 0.4 ? 0x10b981 : 0xef4444);
        const killed = this.health <= 0;
        if (isHeadshot && typeof playHeadshotSound === 'function') playHeadshotSound(); 
        else if (typeof playHitmarkerSound === 'function') playHitmarkerSound();
        showHitmarker(isHeadshot, killed);
        if (hitPoint) showDamagePopup(amount, hitPoint, isHeadshot, isWallbang);
        this.state = 'ALERT_STRAFE'; this.alertTimer = 6.0;
        if (killed) {
            this.triggerRagdoll(struckPartName, isHeadshot, impactVel || new THREE.Vector3(0, 2, -20));
            this.deaths++; playerScore += (isHeadshot ? 125 : 100) + (isWallbang ? 25 : 0);
            teamScorePhantoms += 10; killCount++; updateMatchStatusHUD(); updateKDDisplay(); triggerXPFeed({ isHeadshot, isWallbang });
            const wLabel = (currentWeapon.killLabel || currentWeaponKey.toUpperCase()) + (isWallbang ? ' [WB]' : '');
            addKillFeedEntry('PHANTOM-1', wLabel, this.name, { isHeadshot, isEnemyKill: false });
        }
    }
    triggerRagdoll(struckPartName, isHeadshot, impactVelocity) {
        this.state = 'RAGDOLL'; this.respawnTimer = 3.6; this.hpGroup.visible = false;
        const scale = isHeadshot ? 0.022 : 0.015;
        for (const link of this.ragdollLinks) {
            scene.attach(link.mesh);
            const isStruck = link.name === struckPartName; const mult = isStruck ? 1.65 : 0.75;
            link.velocity.set(
                impactVelocity.x * scale * mult + (Math.random() - 0.5) * 2.2,
                Math.max(2.4, impactVelocity.y * scale + (isStruck ? 4.2 : 2.0)),
                impactVelocity.z * scale * mult + (Math.random() - 0.5) * 2.2
            );
            link.angularVelocity.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
        }
    }
    respawn() {
        this.state = 'PATROL'; this.health = this.maxHealth; this.hpFill.scale.x = 1; this.hpFill.position.x = 0;
        this.hpFill.material.color.setHex(0x10b981); this.hpGroup.visible = true;
        this.mesh.position.copy(this.getRandomTarget()); this.mesh.rotation.set(0, 0, 0);
        for (const link of this.ragdollLinks) {
            this.mesh.add(link.mesh); link.mesh.position.copy(link.defaultLocalPos); link.mesh.rotation.set(0, 0, 0);
            link.mesh.scale.set(1, 1, 1); link.velocity.set(0, 0, 0); link.angularVelocity.set(0, 0, 0);
        }
    }
}
const bots = []; const botNames = ['GHOST-ALPHA', 'GHOST-BRAVO', 'GHOST-CHARLIE', 'GHOST-DELTA'];
botNames.forEach((name, i) => bots.push(new Bot(name, NUKETOWN_WAYPOINTS[i % NUKETOWN_WAYPOINTS.length])));

/* --- Primary/Secondary Loadout Selection & Execution --- */
function getMaxClipFor(weaponKey) {
    const w = WEAPONS[weaponKey]; const l = loadouts[weaponKey];
    const magMod = (ATTACHMENTS.mag[l.mag] && ATTACHMENTS.mag[l.mag].clipMod) || 1.0;
    return Math.round(w.maxClip * magMod);
}

function initSpawnLoadout() {
    const pMax = getMaxClipFor(selectedPrimaryKey); const pWep = WEAPONS[selectedPrimaryKey];
    const sMax = getMaxClipFor(selectedSecondaryKey); const sWep = WEAPONS[selectedSecondaryKey];
    spawnedSlots.primary = { key: selectedPrimaryKey, clip: pMax + (pWep.canChamberRound ? 1 : 0), reserve: pWep.reserve, fireModeIndex: 0 };
    spawnedSlots.secondary = { key: selectedSecondaryKey, clip: sMax + (sWep.canChamberRound ? 1 : 0), reserve: sWep.reserve, fireModeIndex: 0 };
    spawnedSlots.melee = { key: 'bayonet', clip: 0, reserve: 0, fireModeIndex: 0 };
    equipSlot('primary', true);
}

function equipSlot(slotName, force = false) {
    if (slotName !== 'primary' && slotName !== 'secondary' && slotName !== 'melee') return;
    if (isReloading || (!force && slotName === activeSlot && currentWeaponKey === spawnedSlots[slotName].key)) return;

    if (!force && spawnedSlots[activeSlot] && spawnedSlots[activeSlot].key === currentWeaponKey) {
        spawnedSlots[activeSlot].clip = ammoClip;
        spawnedSlots[activeSlot].reserve = ammoReserve;
        spawnedSlots[activeSlot].fireModeIndex = currentFireModeIndex;
    }

    isBoltCycling = false; pendingBoltCycle = false; boltCycleTimer = 0;
    meleeState.active = false; cancelInspect(true);
    if (slotName !== 'melee') lastGunSlot = slotName;
    activeSlot = slotName; const slotData = spawnedSlots[slotName];
    currentWeaponKey = slotData.key; currentWeapon = WEAPONS[currentWeaponKey];
    currentLoadout = loadouts[currentWeaponKey];
    currentFireModeIndex = slotData.fireModeIndex || 0;
    currentFireMode = currentWeapon.availableModes[currentFireModeIndex] || currentWeapon.availableModes[0];
    burstShotsRemaining = 0;

    ammoClip = slotData.clip; ammoReserve = slotData.reserve;

    try { rebuildWeaponMesh(); } catch (err) { console.error('[weapon] could not build', err); }
    isADS = false; gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0';
    recoilPosSpring.shove(new THREE.Vector3(0, -1.1, 0.35)); recoilRotSpring.shove(new THREE.Vector3(-2.4, 0, 1.2));
    updateLoadoutUI();
}

function selectLoadoutWeapon(weaponKey) {
    const w = WEAPONS[weaponKey]; if (!w) return;
    if (w.type === 'MELEE') { currentWeaponKey = weaponKey; currentWeapon = w; currentLoadout = loadouts[weaponKey]; updateLoadoutUI(); updateLoadoutViewer(); return; }
    if (w.type === 'SECONDARY') selectedSecondaryKey = weaponKey; else selectedPrimaryKey = weaponKey;
    currentWeaponKey = weaponKey; currentWeapon = w; currentLoadout = loadouts[weaponKey];
    initSpawnLoadout();
    currentWeaponKey = weaponKey; currentWeapon = w; currentLoadout = loadouts[weaponKey];
    updateLoadoutUI(); updateLoadoutViewer();
}

function updateLoadoutUI() {
    const weapon = WEAPONS[currentWeaponKey];
    const pistolLock = weapon.type === 'SECONDARY';
    if (pistolLock) { currentLoadout.stock = 'standard'; currentLoadout.handle = 'none'; }
    ['stock-select', 'handle-select'].forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        el.disabled = pistolLock; if (el.parentElement) el.parentElement.classList.toggle('locked', pistolLock);
    });
    const lockNote = document.getElementById('attach-note'); if (lockNote) lockNote.classList.toggle('hidden', !pistolLock);
    const opticEl = document.getElementById('optic-select'); if (opticEl) opticEl.value = currentLoadout.scope;
    const muzzleEl = document.getElementById('muzzle-select'); if (muzzleEl) muzzleEl.value = currentLoadout.muzzle;
    const stockEl = document.getElementById('stock-select'); if (stockEl) stockEl.value = currentLoadout.stock;
    const magEl = document.getElementById('mag-select'); if (magEl) magEl.value = currentLoadout.mag;
    const handleEl = document.getElementById('handle-select'); if (handleEl) handleEl.value = currentLoadout.handle;

    const nameEl = document.getElementById('weapon-name-hud');
    const slotTag = activeSlot === 'melee' ? '[MEL] ' : (activeSlot === 'secondary' ? '[SEC] ' : '[PRI] ');
    if (nameEl) nameEl.innerHTML = '<em class="slot-chip">' + slotTag.replace(/[\[\] ]/g, '') + '</em>' + weapon.name;

    document.querySelectorAll('#primary-selectors .weapon-card').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-weapon') === selectedPrimaryKey);
    });
    document.querySelectorAll('#secondary-selectors .weapon-card').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-weapon') === selectedSecondaryKey);
    });
    renderLoadoutInfo(weapon);
    updateAmmoHUD(); updateFiremodeHUD(); updateGrenadeHUD();
}

/* ============================================================================
   MELEE COMBAT
   ============================================================================ */
function playMeleeSwingSound(heavy = false) {
    try {
        if (typeof audioCtx === 'undefined' || !audioCtx) return;
        const ctx = audioCtx, t0 = ctx.currentTime + (heavy ? 0.16 : 0.12), dur = heavy ? 0.2 : 0.26;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(heavy ? 900 : 650, t0); bp.frequency.exponentialRampToValueAtTime(heavy ? 3200 : 2400, t0 + dur * 0.6);
        const g = ctx.createGain(), vol = 0.22 * (gameSettings.volume ?? 1);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t0);
    } catch (err) { /* audio is optional */ }
}

function playMeleeHitSound(metal = false) {
    try {
        if (typeof audioCtx === 'undefined' || !audioCtx) return;
        const ctx = audioCtx, t0 = ctx.currentTime, vol = (gameSettings.volume ?? 1);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = metal ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(metal ? 1900 : 170, t0);
        osc.frequency.exponentialRampToValueAtTime(metal ? 1100 : 70, t0 + 0.12);
        g.gain.setValueAtTime(Math.max(0.0002, (metal ? 0.12 : 0.28) * vol), t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (metal ? 0.14 : 0.16));
        osc.connect(g); g.connect(ctx.destination); osc.start(t0); osc.stop(t0 + 0.18);
    } catch (err) { /* audio is optional */ }
}

function meleeAttack(type = 'slash') {
    if (isDead || meleeState.active || !currentWeapon || currentWeapon.type !== 'MELEE') return;
    const def = MELEE_ATTACKS[type]; if (!def) return;
    meleeState.active = true; meleeState.type = type; meleeState.t = 0; meleeState.hitDone = false;
    if (type === 'slash') meleeState.side *= -1; // alternate right-to-left / left-to-right
    if (isSprinting) { isSprinting = false; sprintCancelledByFire = true; }
    sprintResumeAt = performance.now() + def.duration * 1000 + SPRINT_RESUME_DELAY_MS * 0.5;
    isADS = false;
    playMeleeSwingSound(type === 'stab');
}

function resolveMeleeHit(def, type) {
    camera.updateMatrixWorld(true);
    const origin = new THREE.Vector3(); camera.getWorldPosition(origin);
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    const botParts = [];
    bots.forEach(b => { if (b.state !== 'RAGDOLL') b.ragdollLinks.forEach(l => botParts.push(l.mesh)); });

    // a wall in front of the blade stops the hit
    meleeRay.near = 0; meleeRay.far = def.range; meleeRay.set(origin, fwd);
    const wallHit = meleeRay.intersectObjects(collidableObjects, false)[0] || null;

    let best = null;
    for (const [ox, oy] of def.arc) {
        const dir = fwd.clone().addScaledVector(right, ox).addScaledVector(up, oy).normalize();
        meleeRay.near = 0; meleeRay.far = def.range; meleeRay.set(origin, dir);
        const hit = meleeRay.intersectObjects(botParts, false)[0];
        if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    if (best && wallHit && wallHit.distance < best.distance - 0.05) best = null;

    if (best) {
        const obj = best.object, bot = obj.userData && obj.userData.botRef;
        if (bot) {
            const head = obj.userData.hitZone === 'head';
            const dmg = Math.round(def.damage * (head ? 1.5 : 1));
            triggerImpactVFX(best.point, fwd.clone().negate());
            bot.takeDamage(dmg, head, best.point, obj.userData.partName, fwd.clone().multiplyScalar(type === 'stab' ? 30 : 22), false);
            playMeleeHitSound(false);
            recoilPosSpring.shove(new THREE.Vector3(0, 0, 0.5));
            recoilRotSpring.shove(new THREE.Vector3(-0.5, 0.15, 0.25));
        }
    } else if (wallHit) {
        const n = wallHit.face ? wallHit.face.normal.clone().transformDirection(wallHit.object.matrixWorld).normalize() : fwd.clone().negate();
        triggerImpactVFX(wallHit.point, n);
        playMeleeHitSound(true);
        recoilRotSpring.shove(new THREE.Vector3(-0.3, 0, 0.2));
    }
}

function updateMelee(delta) {
    meleeOffset.pos.set(0, 0, 0); meleeOffset.rot.set(0, 0, 0);
    if (typeof updateMeleePose === 'function') updateMeleePose();
    if (!meleeState.active) return;
    if (!currentWeapon || currentWeapon.type !== 'MELEE') { meleeState.active = false; return; }
    const def = MELEE_ATTACKS[meleeState.type];
    meleeState.t += delta / def.duration;
    const t = meleeState.t;
    if (!meleeState.hitDone && t >= MELEE_HIT_AT) { meleeState.hitDone = true; resolveMeleeHit(def, meleeState.type); }
    if (t >= 1) { meleeState.active = false; return; }

    const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    if (meleeState.type === 'slash') {
        const s = meleeState.side;
        // u: 0 -> -1 (wind-up to one side) -> +1 (sweep across) -> 0 (recover)
        let u;
        if (t < 0.28) u = -sm(t / 0.28);
        else if (t < 0.55) u = -1 + 2 * sm((t - 0.28) / 0.27);
        else u = 1 - sm((t - 0.55) / 0.45);
        meleeOffset.pos.set(-0.30 * u * s, 0.05 * u * u, -0.10 * (1 - u * u));
        meleeOffset.rot.set(-0.25 * (1 - u * u), 0.8 * u * s, -0.6 * u * s);
    } else {
        const pull = sm(t / 0.30), thrust = sm((t - 0.30) / 0.14), ret = sm((t - 0.50) / 0.50);
        const a = pull * (1 - thrust) * (1 - ret); // drawn back
        const b = thrust * (1 - ret);              // fully extended
        meleeOffset.pos.set(-0.04 * a, 0.05 * a - 0.02 * b, 0.16 * a - 0.42 * b);
        meleeOffset.rot.set(0.55 * a - 0.10 * b, 0.12 * b, 0);
    }
}

function startReload() {
    const baseMax = getMaxClipFor(currentWeaponKey);
    const isTactical = ammoClip > 0 && currentWeapon.canChamberRound;
    const targetCapacity = baseMax + (isTactical ? 1 : 0);
    if (ammoClip >= targetCapacity || ammoReserve <= 0 || isReloading || isBoltCycling) return;

    pendingBoltCycle = false; isReloading = true; isADS = false; burstShotsRemaining = 0;
    gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0';
    const clipEl = document.getElementById('ammo-clip');
    if (clipEl) { clipEl.classList.remove('ammo-low'); clipEl.classList.add('ammo-reloading'); clipEl.innerText = isTactical ? 'TAC RLD' : 'RLD'; }

    recoilPosSpring.setTarget(new THREE.Vector3(-0.03, -0.06, 0.02));
    recoilRotSpring.setTarget(new THREE.Vector3(0.18, 0.14, -0.32));

    const reloadMs = playReloadAnimation();
    if (typeof playReloadSound === 'function') playReloadSound(currentWeapon.soundProfile || currentWeaponKey, reloadMs);

    setTimeout(() => {
        recoilPosSpring.shove(new THREE.Vector3(0.05, 0.55, -0.35));
        recoilRotSpring.shove(new THREE.Vector3(-0.9, -0.3, 1.4));
    }, Math.max(100, reloadMs - 320));

    setTimeout(() => {
        const needed = targetCapacity - ammoClip;
        const added = Math.min(needed, ammoReserve);
        ammoClip += added; ammoReserve -= added;
        if (spawnedSlots[activeSlot] && spawnedSlots[activeSlot].key === currentWeaponKey) {
            spawnedSlots[activeSlot].clip = ammoClip; spawnedSlots[activeSlot].reserve = ammoReserve;
        }
        recoilPosSpring.setTarget(new THREE.Vector3(0, 0, 0)); recoilRotSpring.setTarget(new THREE.Vector3(0, 0, 0));
        isReloading = false; updateAmmoHUD();
        const ammoBox = document.getElementById('ammo-display-box');
        if (ammoBox) { ammoBox.classList.add('ammo-replenish'); setTimeout(() => ammoBox.classList.remove('ammo-replenish'), 160); }
        if (currentWeaponKey === 'AWP' && !isDead) startBoltActionSequence(false);
    }, reloadMs);
}

function shoot() {
    if (currentWeapon.type === 'MELEE') { meleeAttack('slash'); return; }
    if (ammoClip <= 0 || isReloading || isDead || isBoltCycling || pendingBoltCycle) return;
    const now = performance.now();
    if (isSprinting && !isSliding && lastHorizSpeed > 2) {
        isSprinting = false; sprintCancelledByFire = true; sprintFireReadyAt = now + SPRINT_FIRE_DELAY_MS;
        sprintResumeAt = now + SPRINT_RESUME_DELAY_MS;
    }
    if (now < sprintFireReadyAt) return;
    const fireInterval = 60000 / currentWeapon.fireRate;
    if (now - lastShotTime < fireInterval) return;

    lastShotTime = now;
    sprintResumeAt = now + SPRINT_RESUME_DELAY_MS;
    ammoClip--;
    if (spawnedSlots[activeSlot] && spawnedSlots[activeSlot].key === currentWeaponKey) {
        spawnedSlots[activeSlot].clip = ammoClip;
    }
    semiFiredThisPull = true;
    if (currentFireMode === FireMode.BURST && burstShotsRemaining > 0) burstShotsRemaining--;

    updateAmmoHUD();
    if (ammoClip <= 0) {
        burstShotsRemaining = 0;
        if (currentWeaponKey !== 'AWP') setTimeout(() => { if (ammoClip <= 0 && ammoReserve > 0 && !isReloading) startReload(); }, 300);
    }

    if (typeof playGunshotSound === 'function') playGunshotSound(currentWeapon.soundProfile || currentWeaponKey);
    triggerMuzzleFlash();

    if (currentWeaponKey === 'AWP') {
        if (isADS) pendingBoltCycle = true;
        else { if (typeof playBoltActionSound === 'function') playBoltActionSound(); startBoltActionSequence(); }
    } else {
        if (typeof ejectShell === 'function') ejectShell();
    }

    const muzzle = ATTACHMENTS.muzzle[currentLoadout.muzzle] || ATTACHMENTS.muzzle.none;
    const stock = ATTACHMENTS.stock[currentLoadout.stock] || ATTACHMENTS.stock.standard;
    const handle = ATTACHMENTS.handle[currentLoadout.handle] || ATTACHMENTS.handle.none;
    const totalClimbMod = (muzzle.recoilClimbMod || 1.0) * (stock.recoilClimbMod || 1.0) * (handle.recoilClimbMod || 1.0);
    const totalKickHMod = (muzzle.recoilKickHMod || 1.0) * (handle.recoilKickHMod || 1.0);

    continuousShots++;
    const sprayFactor = Math.min(1.45, 1.0 + (continuousShots * 0.022));
    const stanceMultiplier = playerStance === 'CROUCH' ? 0.72 : (playerStance === 'PRONE' ? 0.50 : 1.0);
    const adsReduction = isADS ? 0.55 : 1.0;
    const scopeRecoil = (ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron).recoilMod || 1.0;

    controls.pitchObject.rotation.x = THREE.MathUtils.clamp(
        basePitch + cameraRecoilSpring.position.x + prevBreathOffsetY,
        -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01
    );
    controls.yawObject.rotation.y = baseYaw + cameraRecoilSpring.position.y + prevBreathOffsetX;
    camera.updateMatrixWorld(true); gunGroup.updateMatrixWorld(true);

    const isSniperOverlay = ATTACHMENTS.scope[currentLoadout.scope]?.useSniperOverlay;
    const scopeActiveNow = isADS && !isBoltCycling && isSniperOverlay && (performance.now() - adsStartTime) >= SNIPER_SCOPE_DELAY_MS;
    const adsSightLock = isADS ? 0.35 : 1.0;

    const camQuat = camera.getWorldQuaternion(new THREE.Quaternion());
    const sightPitchOffset = scopeActiveNow ? 0 : (recoilRotSpring.position.x * (isADS ? adsSightLock : 0.35));
    const sightYawOffset = scopeActiveNow ? 0 : (recoilRotSpring.position.y * (isADS ? adsSightLock : 0.35));
    const sightRecoilEuler = new THREE.Euler(sightPitchOffset, sightYawOffset, 0, 'YXZ');
    const sightQuat = camQuat.clone().multiply(new THREE.Quaternion().setFromEuler(sightRecoilEuler));

    let spreadRad = isADS ? 0 : (crosshairSpread * 0.00065);
    if (currentWeaponKey === 'AWP' && !wasRMBHeldDuringBolt && !isADS) {
        const movePenalty = lastHorizSpeed > 1.0 ? 0.08 : 0;
        spreadRad = 0.16 + movePenalty + (crosshairSpread * 0.002);
    }

    const fireDir = new THREE.Vector3(0, 0, -1).applyQuaternion(sightQuat);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(sightQuat);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(sightQuat);

    const muzzlePos = getMuzzleWorldPos();
    const camOrigin = camera.getWorldPosition(new THREE.Vector3());
    const botParts = [];
    bots.forEach(b => { if (b.state !== 'RAGDOLL') b.ragdollLinks.forEach(l => botParts.push(l.mesh)); });
    ballisticsRay.set(camOrigin, fireDir);
    ballisticsRay.near = 0.1; ballisticsRay.far = 250;
    const aimHits = ballisticsRay.intersectObjects([...collidableObjects, ...botParts], false);
    const targetPoint = (aimHits.length > 0 && aimHits[0].distance > 1.2) ? aimHits[0].point.clone() : camOrigin.clone().addScaledVector(fireDir, 120);

    const spawnOrigin = isADS ? camOrigin.clone().addScaledVector(fireDir, 0.65).addScaledVector(camUp, -0.005) : muzzlePos;
    const convergedDir = isADS ? fireDir.clone() : targetPoint.sub(spawnOrigin).normalize();

    // Shotgun Buckshot vs Single Projectile
    const pelletCount = currentWeapon.pellets || 1;
    for (let p = 0; p < pelletCount; p++) {
        let pelletDir = convergedDir.clone();
        if (pelletCount > 1 || spreadRad > 0) {
            const pAngle = Math.random() * Math.PI * 2;
            const pRadius = Math.sqrt(Math.random()) * (pelletCount > 1 ? (currentWeapon.pelletSpread || 0.04) * (isADS ? 0.65 : 1.0) : spreadRad);
            pelletDir.addScaledVector(camRight, Math.cos(pAngle) * pRadius).addScaledVector(camUp, Math.sin(pAngle) * pRadius).normalize();
        }
        spawnBallisticProjectile({ origin: spawnOrigin, direction: pelletDir, weapon: currentWeapon, colorHex: currentWeapon.color });
    }

    const posKickZ = currentWeapon.gunKickZ * 38.0 * (isADS ? 0.72 : 1.0) * scopeRecoil;
    const posKickY = (currentWeapon.gunKickUp || 0.003) * 28.0 * adsReduction;
    const posKickX = (Math.random() - 0.5) * 2 * currentWeapon.recoilKickH * 24.0 * totalKickHMod * adsReduction;

    const pitchScale = currentWeaponKey === 'AWP' ? 42.0 : (currentWeaponKey === 'toz34' ? 82.0 : 62.0);
    const rotPitch = currentWeapon.gunRotX * pitchScale * totalClimbMod * sprayFactor * stanceMultiplier * (isADS ? 0.68 : 1.0) * scopeRecoil;
    const rotYaw = (Math.random() - 0.5) * 2 * (currentWeapon.gunRotY || 0.004) * 52.0 * totalKickHMod * (isADS ? 0.60 : 1.0);
    const rotRoll = (Math.random() - 0.5) * 2 * (currentWeapon.gunRotZ || 0.006) * 62.0 * (isADS ? 0.55 : 1.0);

    recoilPosSpring.shove(new THREE.Vector3(posKickX, posKickY, posKickZ));
    recoilRotSpring.shove(new THREE.Vector3(rotPitch, rotYaw, rotRoll));

    const climb = currentWeapon.recoilClimb * 1.45 * totalClimbMod * sprayFactor * stanceMultiplier * (isADS ? 0.85 : 1.0) * scopeRecoil;
    const horiz = (Math.random() - 0.5) * 2 * currentWeapon.recoilKickH * 1.35 * totalKickHMod * sprayFactor * stanceMultiplier;
    basePitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, basePitch + climb));
    baseYaw += horiz;

    const camFollow = isADS ? 0.72 : 0.55;
    cameraRecoilSpring.shove(new THREE.Vector3(rotPitch * camFollow, rotYaw * camFollow, rotRoll * 0.25));

    crosshairSpread = Math.min(28, crosshairSpread + (currentWeaponKey === 'AWP' ? 18 : 4.2) * totalClimbMod);
    crosshairBloomSpring.shove(currentWeaponKey === 'AWP' ? 210 : 95);
}

function triggerRespawn() {
    isDead = false; health = 100;
    initSpawnLoadout();
    grenadeCount = MAX_GRENADES; updateGrenadeHUD();
    breathStamina = 1.0; breathExhausted = false;
    isSliding = false; isVaulting = false; isBoltCycling = false; pendingBoltCycle = false; playerStance = 'STAND';
    eyeHeightSpring.reset(1.6);
    updateHealthHUD(); updateAmmoHUD();
    const spawn = MAP_SPAWNS[Math.floor(Math.random() * MAP_SPAWNS.length)];
    controls.getObject().position.copy(spawn.pos);
    baseYaw = spawn.yaw; basePitch = 0;
    isADS = false; gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0';
    document.getElementById('respawn-screen').classList.add('hidden');
    controls.lock();
}

/* --- Keyboard & Mouse Inputs --- */
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && typeof setAdsTune === 'function') { setAdsTune(!adsTuneOn); return; }
    if (typeof adsTuneOn !== 'undefined' && adsTuneOn) return; // intercepted by tune panel

    if (isDead) {
        if (e.code === 'Space' || e.code === 'Enter') { const btn = document.getElementById('respawn-deploy-btn'); if (btn && !btn.disabled) triggerRespawn(); }
        return;
    }
    if (!controls.isLocked) {
        if (e.code === 'Space' && mapReady && !document.getElementById('main-menu').classList.contains('hidden')) {
            if (typeof initAudioContext === 'function') initAudioContext();
            initSpawnLoadout();
            controls.lock();
        }
        return;
    }
    
    // Slot 1 = Primary, Slot 2 = Secondary, Q = Quick Swap
    if (e.code === 'Digit1') { equipSlot('primary'); return; }
    if (e.code === 'Digit2') { equipSlot('secondary'); return; }
    if (e.code === 'KeyQ') { equipSlot(activeSlot === 'melee' ? lastGunSlot : (activeSlot === 'primary' ? 'secondary' : 'primary')); return; }
    if (e.code === 'Digit3') { equipSlot('melee'); return; }
    if (e.code === 'KeyE') { equipSlot(activeSlot === 'melee' ? lastGunSlot : 'melee'); return; }
    
    if (e.code === 'KeyG') { throwGrenade(); return; }
    if (e.code === 'KeyV') { cycleFireMode(); return; }
    if (e.code === 'KeyF') { if (!e.repeat) startInspect(); return; }
    if (e.code === 'KeyK') { simulateEnemyKill(); return; }

    switch (e.code) {
        case 'KeyW': moveState.forward = true; break;
        case 'KeyS': moveState.backward = true; break;
        case 'KeyA': moveState.left = true; break;
        case 'KeyD': moveState.right = true; break;
        case 'ShiftLeft':
            shiftHeld = true; sprintCancelledByFire = false;
            if (!isADS && playerStance === 'STAND' && !isSliding && !isVaulting) {
                isSprinting = true; gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0';
            } break;
        case 'KeyC': case 'ControlLeft':
            if (!isGrounded || isVaulting) break;
            const isMoving = moveState.forward || moveState.backward || moveState.left || moveState.right;
            if ((shiftHeld || isSprinting) && isMoving && !isSliding && slideCooldown <= 0 && playerStance !== 'PRONE') {
                startSlide(); break;
            }
            if (isSliding) { isSliding = false; playerStance = 'STAND'; }
            else { playerStance = playerStance === 'CROUCH' ? 'STAND' : 'CROUCH'; }
            if (playerStance !== 'STAND') isSprinting = false;
            eyeHeightSpring.setTarget(playerStance === 'CROUCH' ? 1.0 : 1.6);
            break;
        case 'KeyZ':
            if (!isGrounded || isVaulting) break;
            if (isSliding) isSliding = false;
            playerStance = playerStance === 'PRONE' ? 'STAND' : 'PRONE';
            if (playerStance !== 'STAND') isSprinting = false;
            eyeHeightSpring.setTarget(playerStance === 'PRONE' ? 0.45 : 1.6);
            break;
        case 'Space':
            if (tryInitiateVault()) break;
            if (canJump && isGrounded && !isVaulting) {
                if (isSliding) { isSliding = false; velocity.x *= 1.08; velocity.z *= 1.08; }
                playerStance = 'STAND'; eyeHeightSpring.setTarget(1.6);
                velocity.y = (isSprinting || shiftHeld ? 12.5 : 11.0);
                canJump = false; isGrounded = false; landingDip = -0.12;
            } break;
        case 'KeyR': startReload(); break;
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
    if (e.button === 0) {
        window.isMouseDown = true; semiFiredThisPull = false;
        if (currentFireMode === FireMode.BURST && burstShotsRemaining === 0 && ammoClip > 0) {
            burstShotsRemaining = Math.min(currentWeapon.burstCount || 3, ammoClip);
        }
        shoot();
        if (currentWeaponKey === 'AWP' && performance.now() < sprintFireReadyAt) queuedShot = true;
    }
    if (e.button === 2) {
        if (currentWeapon.type === 'MELEE') { meleeAttack('stab'); return; }
        wasRMBHeldDuringBolt = true;
        if (!isBoltCycling) {
            isADS = true; isSprinting = false; adsStartTime = performance.now();
            document.getElementById('sniper-scope').style.opacity = '0'; gunGroup.visible = true;
        }
    }
});
window.addEventListener('mouseup', (e) => {
    if (e.button === 0) { window.isMouseDown = false; semiFiredThisPull = false; }
    if (e.button === 2) {
        wasRMBHeldDuringBolt = false; isADS = false;
        document.getElementById('sniper-scope').style.opacity = '0'; gunGroup.visible = true;
        if (pendingBoltCycle && currentWeaponKey === 'AWP' && !isReloading && !isDead) {
            pendingBoltCycle = false;
            if (typeof playBoltActionSound === 'function') playBoltActionSound();
            startBoltActionSequence();
        }
        if (shiftHeld && playerStance === 'STAND' && !isSliding && !isVaulting && !isBoltCycling) {
            if (performance.now() >= sprintResumeAt) isSprinting = true;
            else sprintCancelledByFire = true; // let the update loop resume sprint once the post-shot delay has passed
        }
    }
});
window.addEventListener('wheel', (e) => {
    if (!controls.isLocked || isDead || isReloading) return;
    if (Math.abs(e.deltaY) > 0) equipSlot(activeSlot === 'melee' ? lastGunSlot : (activeSlot === 'primary' ? 'secondary' : 'primary'));
});
window.addEventListener('blur', () => {
    window.isMouseDown = false; wasRMBHeldDuringBolt = false; shiftHeld = false; sprintCancelledByFire = false; queuedShot = false;
    moveState.forward = false; moveState.backward = false; moveState.left = false; moveState.right = false; isSprinting = false;
});
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (typeof resizeLoadoutViewer === 'function') resizeLoadoutViewer();
});

/* --- Loadout 3D Viewer (restored) --- */
const loadoutScene = new THREE.Scene();
loadoutScene.background = new THREE.Color(0x0f172a);
const loadoutCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
loadoutCamera.position.set(0, 0.2, 1.2); loadoutCamera.lookAt(0, 0, 0);
const loadoutRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
loadoutRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
{ const host = document.getElementById('loadout-viewer'); if (host) host.appendChild(loadoutRenderer.domElement); }
const loadoutLight = new THREE.DirectionalLight(0xffffff, 1.5);
loadoutLight.position.set(2, 5, 3); loadoutScene.add(loadoutLight);
loadoutScene.add(new THREE.AmbientLight(0xffffff, 0.8));
const loadoutGunGroup = new THREE.Group(); loadoutScene.add(loadoutGunGroup);
loadoutGunGroup.rotation.order = 'YXZ';

function resizeLoadoutViewer() {
    const container = document.getElementById('loadout-viewer');
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        const w = container.clientWidth; const h = container.clientHeight;
        loadoutRenderer.setSize(w, h); loadoutCamera.aspect = w / h; loadoutCamera.updateProjectionMatrix();
    }
}

const LOADOUT_VIEW_DEFAULT = { yaw: -Math.PI / 4, pitch: 0.1, panX: 0, panY: 0, zoom: 1 };
const loadoutView = { ...LOADOUT_VIEW_DEFAULT };
let loadoutAutoRotate = true;
let loadoutDrag = null;

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
    const savedAnim = weaponAnim;
    let tempGun = null;
    try { tempGun = createProceduralWeapon(currentWeaponKey, currentLoadout); }
    catch (err) { console.error('[loadout viewer] could not build weapon', err); }
    weaponAnim = savedAnim;
    if (!tempGun) return;
    tempGun.position.set(0, 0, 0); tempGun.rotation.set(0, 0, 0); tempGun.scale.setScalar(1);
    loadoutGunGroup.add(tempGun);
    loadoutGunGroup.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(tempGun);
    const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    const fit = 0.8 / Math.max(size.x, size.y, size.z, 0.0001);
    tempGun.scale.setScalar(fit);
    tempGun.position.copy(center).multiplyScalar(-fit);

    applyLoadoutView();
    resizeLoadoutViewer();
}

function animateLoadoutViewer() {
    requestAnimationFrame(animateLoadoutViewer);
    const screen = document.getElementById('loadout-screen');
    if (screen && !screen.classList.contains('hidden')) {
        if (loadoutAutoRotate && !loadoutDrag) loadoutView.yaw += 0.005;
        applyLoadoutView();
        loadoutRenderer.render(loadoutScene, loadoutCamera);
    }
}
animateLoadoutViewer();

/* --- UI Menu Interactions --- */
document.querySelectorAll('.weapon-card').forEach(card => {
    card.addEventListener('click', (e) => selectLoadoutWeapon(e.currentTarget.getAttribute('data-weapon')));
});
document.getElementById('btn-play').addEventListener('click', () => {
    if (typeof initAudioContext === 'function') initAudioContext();
    initSpawnLoadout();
    controls.lock();
});
['optic-select', 'muzzle-select', 'stock-select', 'mag-select', 'handle-select'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('change', (e) => {
        const val = e.target.value; const part = id === 'optic-select' ? 'scope' : id.replace('-select', '');
        currentLoadout[part] = val;
        rebuildWeaponMesh(); updateLoadoutUI(); updateLoadoutViewer();
    });
});
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
document.getElementById('setting-fov').addEventListener('input', (e) => {
    const val = parseInt(e.target.value); gameSettings.fov = val; document.getElementById('val-setting-fov').innerText = `${val}°`;
    camera.fov = val; camera.updateProjectionMatrix(); saveSettings();
});
document.getElementById('setting-volume').addEventListener('input', (e) => {
    const val = parseInt(e.target.value); if (typeof setMasterVolume === 'function') setMasterVolume(val / 100);
    document.getElementById('val-setting-volume').innerText = `${val}%`; saveSettings();
});
document.getElementById('setting-sens').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value); gameSettings.sensitivity = val;
    document.getElementById('val-setting-sens').innerText = `${val.toFixed(2)}x`; saveSettings();
});

/* ======== Restored gameplay / HUD functions ======== */
function tryInitiateVault() {
    if (isVaulting || isSliding) return false;
    const playerObj = controls.getObject();
    const footY = playerObj.position.y - eyeHeightSpring.position;
    const forward = new THREE.Vector3(-Math.sin(baseYaw), 0, -Math.cos(baseYaw)).normalize();

    const lowOrigin = new THREE.Vector3(playerObj.position.x, footY + 0.55, playerObj.position.z);
    vaultRay.set(lowOrigin, forward);
    vaultRay.near = 0;
    vaultRay.far = 1.65;
    const lowHits = vaultRay.intersectObjects(collidableObjects, false);
    if (lowHits.length === 0) return false;
    const obsHit = lowHits[0];

    const highOrigin = new THREE.Vector3(playerObj.position.x, footY + 1.65, playerObj.position.z);
    vaultRay.set(highOrigin, forward);
    vaultRay.far = obsHit.distance + 0.65;
    if (vaultRay.intersectObjects(collidableObjects, false).length > 0) return false;

    const reach = obsHit.distance + 0.55;
    const ledgeProbe = new THREE.Vector3(
        playerObj.position.x + forward.x * reach,
        footY + 1.7,
        playerObj.position.z + forward.z * reach
    );
    vaultRay.set(ledgeProbe, new THREE.Vector3(0, -1, 0));
    vaultRay.far = 1.6;
    const topHits = vaultRay.intersectObjects(collidableObjects, false);
    if (topHits.length === 0) return false;

    const ledgeY = topHits[0].point.y;
    const heightDiff = ledgeY - footY;
    if (heightDiff < 0.4 || heightDiff > 1.45) return false;

    isVaulting = true;
    vaultTimer = 0;
    playerStance = 'VAULT';
    eyeHeightSpring.setTarget(1.6);
    vaultStartPos.copy(playerObj.position);
    vaultEndPos.set(ledgeProbe.x, ledgeY + 1.62, ledgeProbe.z);

    eyeHeightSpring.shove(-1.8);
    landingDip = -0.10;
    return true;
}

function updateGrenadeHUD() {
    const el = document.getElementById('grenade-count');
    if (el) el.innerText = grenadeCount;
    const pipsContainer = document.getElementById('grenade-pips');
    if (pipsContainer) {
        const pips = pipsContainer.querySelectorAll('.grenade-pip');
        pips.forEach((pip, idx) => {
            pip.classList.toggle('active', idx < grenadeCount);
        });
    }
}

function playGrenadeThrowSound() {
    try {
        if (typeof audioCtx !== 'undefined' && audioCtx) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(240, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(90, audioCtx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.2 * (gameSettings.volume ?? 1), audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.12);
        }
    } catch (e) {}
}

function playExplosionSound() {
    try {
        const ctx = (typeof audioCtx !== 'undefined' && audioCtx) ? audioCtx : new (window.AudioContext || window.webkitAudioContext)();
        const duration = 1.1;
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.22));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(280, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + duration);

        const gain = ctx.createGain();
        const vol = (gameSettings.volume ?? 1.0) * 0.9;
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

        noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
        noise.start();
    } catch (e) {}
}

function createGrenadeMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.45, metalness: 0.5 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3, metalness: 0.85 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), bodyMat);
    body.scale.y = 1.25;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.113, 0.113, 0.035, 12), ringMat);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.07, 8), metalMat);
    neck.position.y = 0.14;
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.05), metalMat);
    lever.position.set(0, 0.06, 0.09);

    group.add(body, band, neck, lever);
    return group;
}

function throwGrenade() {
    if (isDead || grenadeCount <= 0) return;
    const now = performance.now();
    if (now - lastGrenadeTime < GRENADE_COOLDOWN_MS) return;
    cancelInspect(true);
    lastGrenadeTime = now;
    grenadeCount--;
    updateGrenadeHUD();
    playGrenadeThrowSound();

    recoilRotSpring.shove(new THREE.Vector3(-0.9, 0.2, 0.4));
    recoilPosSpring.shove(new THREE.Vector3(0, -0.25, 0.3));

    const mesh = createGrenadeMesh();
    const startPos = new THREE.Vector3();
    camera.getWorldPosition(startPos);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    startPos.addScaledVector(forward, 0.65);
    startPos.y -= 0.12;
    mesh.position.copy(startPos);
    scene.add(mesh);

    const playerWorldVel = new THREE.Vector3(-velocity.x, 0, velocity.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawObject.rotation.y);
    const throwVel = forward.clone().multiplyScalar(24.0);
    throwVel.y += 5.5;
    throwVel.addScaledVector(playerWorldVel, 0.35);

    activeGrenades.push({
        mesh,
        vel: throwVel,
        spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
        age: 0
    });
}

function detonateGrenade(pos) {
    playExplosionSound();
    breakGlassInRadius(pos, GRENADE_RADIUS);

    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.95 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 14), coreMat);
    core.position.copy(pos);
    scene.add(core);

    const waveMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.75, wireframe: true });
    const wave = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12), waveMat);
    wave.position.copy(pos);
    scene.add(wave);

    const flashLight = new THREE.PointLight(0xf97316, 6, 22);
    flashLight.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
    scene.add(flashLight);

    const sparks = [];
    const sparkGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    for (let i = 0; i < 18; i++) {
        const sMat = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xfbbf24 : 0xef4444, transparent: true, opacity: 1 });
        const sMesh = new THREE.Mesh(sparkGeo, sMat);
        sMesh.position.copy(pos);
        const sVel = new THREE.Vector3((Math.random() - 0.5) * 22, Math.random() * 14 + 3, (Math.random() - 0.5) * 22);
        scene.add(sMesh);
        sparks.push({ mesh: sMesh, mat: sMat, vel: sVel });
    }

    activeExplosions.push({ core, coreMat, wave, waveMat, flashLight, sparks, age: 0, duration: 0.55 });

    bots.forEach(bot => {
        if (bot.state === 'RAGDOLL') return;
        const botCenter = bot.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        const dist = botCenter.distanceTo(pos);
        if (dist <= GRENADE_RADIUS) {
            const falloff = 1 - (dist / GRENADE_RADIUS);
            const dmg = Math.round(145 * Math.pow(falloff, 0.85));
            const blastVel = botCenter.clone().sub(pos).normalize().multiplyScalar(28 * falloff);
            if (dmg > 0) bot.takeDamage(dmg, false, botCenter, 'torso', blastVel, false);
        }
    });

    const playerPos = controls.getObject().position;
    const playerDist = playerPos.distanceTo(pos);
    if (playerDist <= GRENADE_RADIUS) {
        const falloff = 1 - (playerDist / GRENADE_RADIUS);
        const selfDmg = Math.round(95 * Math.pow(falloff, 1.1));
        cameraRecoilSpring.shove(new THREE.Vector3(0.4 * falloff, (Math.random() - 0.5) * 0.4 * falloff, 0.3 * falloff));
        if (selfDmg > 0) damagePlayer(selfDmg, null);
    }
}

function updateGrenades(delta) {
    const grRay = new THREE.Raycaster();
    for (let i = activeGrenades.length - 1; i >= 0; i--) {
        const g = activeGrenades[i];
        g.age += delta;
        if (g.age >= GRENADE_FUSE) {
            const detPos = g.mesh.position.clone();
            scene.remove(g.mesh);
            activeGrenades.splice(i, 1);
            detonateGrenade(detPos);
            continue;
        }

        g.vel.y -= 9.8 * 2.2 * delta;
        const step = g.vel.clone().multiplyScalar(delta);
        const stepLen = step.length();
        if (stepLen > 0.0001) {
            grRay.set(g.mesh.position, step.clone().normalize());
            grRay.far = stepLen + 0.14;
            const hits = grRay.intersectObjects(collidableObjects, false);
            if (hits.length > 0 && hits[0].face) {
                const normal = hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).normalize();
                g.vel.reflect(normal).multiplyScalar(0.52);
                g.mesh.position.copy(hits[0].point).addScaledVector(normal, 0.15);
            } else {
                g.mesh.position.add(step);
            }
        }

        if (g.mesh.position.y <= 0.14) {
            g.mesh.position.y = 0.14;
            if (Math.abs(g.vel.y) > 1.5) {
                g.vel.y = -g.vel.y * 0.45;
                g.vel.x *= 0.72;
                g.vel.z *= 0.72;
            } else {
                g.vel.y = 0;
                g.vel.x *= Math.max(0, 1 - 6 * delta);
                g.vel.z *= Math.max(0, 1 - 6 * delta);
                g.spin.multiplyScalar(0.85);
            }
        }

        g.mesh.rotation.x += g.spin.x * delta;
        g.mesh.rotation.y += g.spin.y * delta;
        g.mesh.rotation.z += g.spin.z * delta;
    }

    for (let i = activeExplosions.length - 1; i >= 0; i--) {
        const ex = activeExplosions[i];
        ex.age += delta;
        const t = Math.min(1, ex.age / ex.duration);
        ex.core.scale.setScalar(1 + t * 8);
        ex.coreMat.opacity = (1 - t) * 0.9;
        ex.wave.scale.setScalar(1 + t * GRENADE_RADIUS);
        ex.waveMat.opacity = (1 - t) * 0.65;
        ex.flashLight.intensity = (1 - t) * 6;
        ex.sparks.forEach(s => {
            s.vel.y -= 9.8 * 2 * delta;
            s.mesh.position.addScaledVector(s.vel, delta);
            s.mat.opacity = 1 - t;
        });

        if (t >= 1) {
            scene.remove(ex.core, ex.wave, ex.flashLight);
            ex.sparks.forEach(s => scene.remove(s.mesh));
            activeExplosions.splice(i, 1);
        }
    }
}

function getMaxClip() { return getMaxClipFor(currentWeaponKey); }

function updateAmmoHUD() {
    const clipEl = document.getElementById('ammo-clip');
    const resEl = document.getElementById('ammo-reserve');
    if (currentWeapon && currentWeapon.type === 'MELEE') {
        if (clipEl) { clipEl.innerText = '--'; clipEl.classList.remove('ammo-low', 'ammo-reloading'); }
        if (resEl) resEl.innerText = '--';
        return;
    }
    if (clipEl && !isReloading) {
        clipEl.innerText = ammoClip;
        clipEl.classList.remove('ammo-reloading');
        clipEl.classList.toggle('ammo-low', ammoClip <= Math.max(1, Math.floor(getMaxClip() * 0.25)));
    }
    if (resEl) resEl.innerText = ammoReserve;
}

function updateFiremodeHUD() {
    const fmEl = document.getElementById('firemode-hud');
    if (fmEl) {
        fmEl.innerText = currentFireMode;
    }
    const strip = document.getElementById('firemode-strip');
    if (strip) {
        const modes = (currentWeapon && currentWeapon.availableModes) || [FireMode.AUTO];
        strip.innerHTML = '';
        modes.forEach(m => {
            const pill = document.createElement('span');
            pill.className = 'fm-pill' + (m === currentFireMode ? ' active' : '');
            pill.dataset.mode = m;
            pill.innerText = m;
            strip.appendChild(pill);
        });
    }
}

function cycleFireMode() {
    const modes = currentWeapon.availableModes || [FireMode.AUTO];
    if (modes.length <= 1) return;
    currentFireModeIndex = (currentFireModeIndex + 1) % modes.length;
    currentFireMode = modes[currentFireModeIndex];
    burstShotsRemaining = 0;
    recoilRotSpring.shove(new THREE.Vector3(0.12, 0.1, -0.55));
    playMechanicalClick(980);
    updateFiremodeHUD();
}

/* ============================================================================
   WEAPON INSPECT (F): a procedural hold-and-turn animation layered on the normal weapon pose.
   Any action (fire, aim, reload, sprint, slide, switch, melee, grenade, death) cancels it.
   ============================================================================ */
const inspectEase = (x) => x * x * (3 - 2 * x);

function canInspect() {
    return !!currentWeapon && !isDead && !isReloading && !isADS && !isSprinting && !isSliding && !isVaulting
        && !isBoltCycling && !meleeState.active && !window.isMouseDown;
}

function startInspect() {
    if (inspectState.active || !controls.isLocked || !canInspect()) return;
    inspectState.active = true; inspectState.t = 0; inspectState.weight = 1; inspectState.clicked = false;
    inspectState.melee = currentWeapon.type === 'MELEE';
    playMechanicalClick(540);
}

function cancelInspect(hard) {
    inspectState.active = false;
    if (hard) inspectState.weight = 0;
}

function updateInspect(delta) {
    inspectOffset.pos.set(0, 0, 0); inspectOffset.rot.set(0, 0, 0);
    const kind = inspectState.melee ? 'melee' : 'gun';
    if (inspectState.active) {
        if (!canInspect()) cancelInspect(false);
        else {
            inspectState.t += delta / INSPECT_DURATION[kind];
            if (!inspectState.clicked && inspectState.t > 0.4) { inspectState.clicked = true; playMechanicalClick(700); }
            if (inspectState.t >= 1) cancelInspect(true);
        }
    }
    if (!inspectState.active) inspectState.weight = Math.max(0, inspectState.weight - delta * 7); // quick ease-out when interrupted
    if (inspectState.weight <= 0) return;
    const frames = INSPECT_FRAMES[kind], u = Math.min(inspectState.t, 1);
    let i = 0; while (i < frames.length - 2 && u > frames[i + 1][0]) i++;
    const a = frames[i], b = frames[i + 1];
    const k = inspectEase(THREE.MathUtils.clamp((u - a[0]) / (b[0] - a[0]), 0, 1));
    const f = (n) => (a[n] + (b[n] - a[n]) * k) * inspectState.weight;
    inspectOffset.pos.set(f(1), f(2), f(3)); inspectOffset.rot.set(f(4), f(5), f(6));
}

function triggerAutoReload() { if (ammoClip <= 0 && ammoReserve > 0 && !isReloading) startReload(); }

function updateCrosshairVisuals() {
    const top = document.getElementById('ch-top'); const bottom = document.getElementById('ch-bottom');
    const left = document.getElementById('ch-left'); const right = document.getElementById('ch-right');
    const sniperHipOffset = (currentWeaponKey === 'AWP' && !isADS) ? 20 : 0;
    const bloomPx = Math.max(0, crosshairSpread * 0.85 + crosshairBloomSpring.position);
    const offset = 7 + sniperHipOffset + bloomPx;
    if (top) top.style.transform = `translate3d(0, -${offset.toFixed(2)}px, 0)`;
    if (bottom) bottom.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    if (left) left.style.transform = `translate3d(-${offset.toFixed(2)}px, 0, 0)`;
    if (right) right.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`;
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

function getTracerAssets(colorHex) {
    if (!_tracerGeo) {
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

function getMuzzleWorldPos() {
    const out = new THREE.Vector3();
    camera.updateMatrixWorld(true);
    gunGroup.updateMatrixWorld(true);
    if (customGunMesh) {
        const mf = customGunMesh.getObjectByName('muzzleFlash');
        if (mf) {
            return mf.getWorldPosition(out);
        }
        const ud = customGunMesh.userData;
        if (ud && ud.muzzleZ != null) {
            return customGunMesh.localToWorld(out.set(0, ud.muzzleY ?? 0.02, ud.muzzleZ));
        }
    }
    return gunGroup.getWorldPosition(out);
}

function showHitmarker(isHeadshot = false, isKill = false) {
    const hm = document.getElementById('hitmarker');
    if (!hm) return;
    if (_hmTimeout) clearTimeout(_hmTimeout);
    if (_hmScaleTimeout) clearTimeout(_hmScaleTimeout);

    // Colour states: body = white, headshot (incl. headshot kill) = amber, other kill = crimson
    hm.classList.toggle('hm-headshot', isHeadshot);
    hm.classList.toggle('hm-kill', isKill && !isHeadshot);
    hm.style.opacity = '1';

    const pop = isHeadshot || isKill;
    if (pop) {
        const s0 = (isHeadshot && isKill) ? 1.3 : 1.2;
        hm.style.transform = `translate3d(0, 0, 0) scale3d(${s0}, ${s0}, 1)`;
        _hmScaleTimeout = setTimeout(() => {
            hm.style.transform = 'translate3d(0, 0, 0) scale3d(1, 1, 1)';
        }, 55);
    } else {
        hm.style.transform = 'translate3d(0, 0, 0) scale3d(1, 1, 1)';
    }

    const duration = pop ? 140 : 100;
    _hmTimeout = setTimeout(() => {
        hm.style.opacity = '0';
        hm.style.transform = 'translate3d(0, 0, 0) scale3d(1, 1, 1)';
    }, duration);
}

function triggerXPFeed({ isHeadshot = false, isWallbang = false } = {}) {
    const container = document.getElementById('xp-feed');
    if (!container) return;

    const pushRow = (text, cls) => {
        const row = document.createElement('div');
        row.className = `xp-entry ${cls}`;
        row.innerText = text;
        container.appendChild(row);
        setTimeout(() => row.remove(), 1200);
    };

    pushRow('+ 100 ENEMY KILLED', 'xp-kill');
    if (isHeadshot) {
        pushRow('+ 25 HEADSHOT BONUS', 'xp-bonus');
    }
    if (isWallbang) {
        pushRow('+ 25 WALLBANG BONUS', 'xp-wallbang');
    }
}

function showKillNotification(txt) {
    const isHS = typeof txt === 'string' && txt.includes('HEADSHOT');
    const isWB = typeof txt === 'string' && txt.includes('WALLBANG');
    triggerXPFeed({ isHeadshot: isHS, isWallbang: isWB });
}

function showDamagePopup(amt, worldPos, isHeadshot = false, isWallbang = false) {
    const screenPos = worldPos.clone().project(camera);
    if (screenPos.z > 1) return;
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;
    const popup = document.createElement('div'); popup.className = 'damage-popup';
    const wb = isWallbang ? ' [WB]' : '';
    if (isHeadshot) { popup.innerText = `CRIT -${amt}${wb}`; popup.style.color = '#ef4444'; popup.style.fontSize = '32px'; }
    else { popup.innerText = `-${amt}${wb}`; popup.style.color = isWallbang ? '#38bdf8' : '#fbbf24'; }
    popup.style.left = `${x}px`; popup.style.top = `${y}px`;
    document.getElementById('popups-container').appendChild(popup);
    setTimeout(() => popup.remove(), 800);
}

function startBoltActionSequence(shouldEject = true) {
    pendingBoltCycle = false;
    isBoltCycling = true;
    boltCycleTimer = 0;
    wasRMBHeldDuringBolt = isADS;

    // Briefly exit sniper scope overlay so the player can see the physical bolt-action animation
    const isSniperOverlay = ATTACHMENTS.scope[currentLoadout.scope]?.useSniperOverlay;
    if (isADS && isSniperOverlay) {
        isADS = false;
        document.getElementById('sniper-scope').style.opacity = '0';
        gunGroup.visible = true;
    }

    if (ammoClip <= 0) {
        setTimeout(() => triggerAutoReload(), 980);
    }

    // Mechanical spring impulses synchronized with bolt pull & bolt lock
    setTimeout(() => {
        if (!isBoltCycling) return;
        recoilPosSpring.shove(new THREE.Vector3(-0.04, -0.05, 0.28));
        recoilRotSpring.shove(new THREE.Vector3(0.35, -0.25, -1.35));
        if (shouldEject) ejectShell();
        if (typeof playBoltBackSound === 'function') playBoltBackSound('AWP');
        playMechanicalClick(620);
    }, 240);

    setTimeout(() => {
        if (!isBoltCycling) return;
        recoilPosSpring.shove(new THREE.Vector3(0.03, 0.06, -0.24));
        recoilRotSpring.shove(new THREE.Vector3(-0.30, 0.20, 1.15));
        if (typeof playBoltForwardSound === 'function') playBoltForwardSound('AWP');
        playMechanicalClick(890);
    }, 620);
}

function updateHealthHUD() {
    const hpBar = document.getElementById('hp-bar');
    const hpText = document.getElementById('hp-text');
    const hpPanel = document.getElementById('health-telemetry');
    if (hpBar) hpBar.style.transform = `scaleX(${(Math.max(0, Math.min(100, health)) / 100).toFixed(3)})`;
    if (hpText) hpText.innerText = Math.max(0, Math.round(health));
    if (hpPanel) {
        hpPanel.classList.toggle('hp-warn', health <= 50 && health >= 25);
        hpPanel.classList.toggle('hp-crit', health < 25);
    }
}

function updateMatchStatusHUD() {
    const sp = document.getElementById('score-phantoms');
    const sg = document.getElementById('score-ghosts');
    const bp = document.getElementById('bar-phantoms');
    const bg = document.getElementById('bar-ghosts');
    if (sp) sp.innerText = teamScorePhantoms;
    if (sg) sg.innerText = teamScoreGhosts;
    if (bp) bp.style.transform = `scaleX(${Math.min(1, teamScorePhantoms / MAX_TEAM_TICKETS).toFixed(3)})`;
    if (bg) bg.style.transform = `scaleX(${Math.min(1, teamScoreGhosts / MAX_TEAM_TICKETS).toFixed(3)})`;
}

function updateMatchTimerHUD(dt) {
    if (matchTimeSeconds > 0) {
        matchTimeSeconds = Math.max(0, matchTimeSeconds - dt);
    }
    const mins = Math.floor(matchTimeSeconds / 60);
    const secs = Math.floor(matchTimeSeconds % 60);
    const timerEl = document.getElementById('match-timer');
    if (timerEl) {
        timerEl.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

function simulateEnemyKill() {
    playHeadshotSound();
    showHitmarker(true, true);
    crosshairBloomSpring.shove(85);
    killCount++;
    playerScore += 125;
    teamScorePhantoms += 10;
    updateMatchStatusHUD();
    updateKDDisplay();
    triggerXPFeed({ isHeadshot: true, isWallbang: false });
    const victimName = botNames[(killCount - 1) % botNames.length] || 'GHOST-ACTUAL';
    addKillFeedEntry('PHANTOM-1', currentWeaponKey.toUpperCase(), victimName, { isHeadshot: true, isEnemyKill: false });
}

function damagePlayer(amount, source = null) {
    if (isDead) return;
    if (source) lastAttacker = source;
    health = Math.max(0, health - amount);
    updateHealthHUD();
    const flash = document.getElementById('hit-flash');
    if (flash) {
        flash.style.backgroundColor = 'rgba(255, 30, 56, 0.32)';
        setTimeout(() => flash.style.backgroundColor = 'rgba(255, 30, 56, 0)', 100);
    }
    if (health <= 0 && !isDead) {
        isDead = true; deathCount++;
        isSliding = false; isVaulting = false; isBoltCycling = false; pendingBoltCycle = false;
        if (lastAttacker) {
            lastAttacker.kills++; lastAttacker.score += 100; teamScoreGhosts += 10;
            updateMatchStatusHUD();
            addKillFeedEntry(lastAttacker.name, 'MP5', 'PHANTOM-1', { isHeadshot: false, isEnemyKill: true });
            lastAttacker = null;
        } else {
            addKillFeedEntry('ENV', 'HAZARD', 'PHANTOM-1', { isHeadshot: false, isEnemyKill: true });
        }
        updateKDDisplay(); controls.unlock();
        document.getElementById('respawn-screen').classList.remove('hidden');
        let timeLeft = 5; const timerEl = document.getElementById('respawn-timer');
        const deployBtn = document.getElementById('respawn-deploy-btn');
        timerEl.innerText = timeLeft; deployBtn.disabled = true;
        deployBtn.className = "menu-btn primary"; deployBtn.innerText = `DEPLOYING IN ${timeLeft}S`;
        if (respawnInterval) clearInterval(respawnInterval);
        respawnInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) { timerEl.innerText = timeLeft; deployBtn.innerText = `DEPLOYING IN ${timeLeft}S`; }
            else {
                clearInterval(respawnInterval); timerEl.innerText = '0'; deployBtn.disabled = false;
                deployBtn.innerText = "DEPLOY NOW";
            }
        }, 1000);
    }
}

document.getElementById('respawn-deploy-btn').addEventListener('click', () => {
    const btn = document.getElementById('respawn-deploy-btn'); if (!btn.disabled) triggerRespawn();
});

function addKillFeedEntry(killerOrMsg, weaponName = null, victim = null, opts = {}) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const row = document.createElement('div');
    row.className = 'kf-row' + (opts.isEnemyKill ? ' kf-enemy' : '');

    if (weaponName && victim) {
        const kSpan = document.createElement('span');
        kSpan.className = 'kf-killer';
        kSpan.innerText = killerOrMsg;

        const wSpan = document.createElement('span');
        wSpan.className = 'kf-weapon' + (opts.isHeadshot ? ' kf-hs' : '');
        wSpan.innerText = opts.isHeadshot ? `${weaponName} ⌖` : weaponName;

        const vSpan = document.createElement('span');
        vSpan.className = 'kf-victim';
        vSpan.innerText = victim;

        row.append(kSpan, wSpan, vSpan);
    } else {
        const kSpan = document.createElement('span');
        kSpan.className = 'kf-killer';
        kSpan.innerText = killerOrMsg;
        row.appendChild(kSpan);
    }

    feed.appendChild(row);
    while (feed.children.length > 5) {
        feed.removeChild(feed.firstChild);
    }
    setTimeout(() => row.classList.add('kf-out'), 2750);
    setTimeout(() => row.remove(), 3000);
}

function updateKDDisplay() { const el = document.getElementById('kd-display'); if (el) el.innerText = `${killCount} / ${deathCount}`; }

function startSlide() {
    isSliding = true;
    isSprinting = false;
    slideTimer = SLIDE_DURATION;
    slideCooldown = SLIDE_COOLDOWN;
    playerStance = 'SLIDE';
    eyeHeightSpring.setTarget(0.68);

    let fwd = Number(moveState.forward) - Number(moveState.backward);
    let right = Number(moveState.right) - Number(moveState.left);
    if (fwd === 0 && right === 0) fwd = 1;
    const len = Math.hypot(fwd, right) || 1;
    slideVel.set(-(right / len) * 24.0, 0, -(fwd / len) * 24.0);
    landingDip = -0.10;
}

function resolveRadialCollisions(playerObj, curEyeH) {
    const footY = playerObj.position.y - curEyeH;
    const checkHeights = [footY + 0.45, footY + curEyeH * 0.75];
    for (let h = 0; h < checkHeights.length; h++) {
        const origin = new THREE.Vector3(playerObj.position.x, checkHeights[h], playerObj.position.z);
        for (let i = 0; i < RADIAL_ANGLES.length; i++) {
            const ang = RADIAL_ANGLES[i];
            const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
            radialRay.set(origin, dir);
            radialRay.near = 0;
            radialRay.far = PLAYER_RADIUS;
            const hits = radialRay.intersectObjects(collidableObjects, false);
            if (hits.length > 0 && hits[0].object !== collidableObjects[0]) {
                const pen = PLAYER_RADIUS - hits[0].distance;
                playerObj.position.addScaledVector(dir, -pen);
            }
        }
    }
}

/* --- Main Logic Loop --- */
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    updateBallistics(delta);
    updateFeedbackPools(delta);
    updateGlassShards(delta);
    updateGrenades(delta);
    if (typeof updateWeaponAnim === 'function') updateWeaponAnim(delta);
    updateMelee(delta);
    updateInspect(delta);

    if (controls.isLocked) {
        if (slideCooldown > 0) slideCooldown = Math.max(0, slideCooldown - delta);

        if (currentFireMode === FireMode.AUTO && window.isMouseDown) shoot();
        else if (currentFireMode === FireMode.BURST && burstShotsRemaining > 0) shoot();
        if (queuedShot && performance.now() >= sprintFireReadyAt) { queuedShot = false; if (currentWeaponKey === 'AWP') shoot(); }
        if (sprintCancelledByFire && shiftHeld && !isSprinting && !isSliding && !isVaulting && !window.isMouseDown && !queuedShot && !isADS && playerStance === 'STAND' && performance.now() >= sprintFireReadyAt && performance.now() >= sprintResumeAt) {
            isSprinting = true; sprintCancelledByFire = false;
        }

        if (pendingBoltCycle && !isADS && currentWeaponKey === 'AWP' && !isReloading && !isDead && !isBoltCycling) {
            pendingBoltCycle = false;
            if (typeof playBoltActionSound === 'function') playBoltActionSound();
            startBoltActionSequence();
        }

        let boltOffsetX = 0, boltOffsetY = 0, boltOffsetZ = 0;
        let boltRotX = 0, boltRotY = 0, boltRotZ = 0;
        if (isBoltCycling) {
            boltCycleTimer += delta;
            const p = Math.min(1, boltCycleTimer / BOLT_CYCLE_DURATION);
            const env = Math.sin(p * Math.PI);
            const pullBack = p > 0.22 && p < 0.78 ? Math.sin(((p - 0.22) / 0.56) * Math.PI) : 0;
            boltOffsetX = -0.055 * env; boltOffsetY = -0.035 * env + 0.02 * pullBack; boltOffsetZ = 0.085 * pullBack;
            boltRotZ = -0.42 * env; boltRotX = 0.18 * env + 0.12 * pullBack; boltRotY = 0.10 * env;
            const boltNode = customGunMesh && (customGunMesh.getObjectByName('Object_26') || customGunMesh.getObjectByName('object_26'));
            if (boltNode) {
                const boltLift = p < 0.10 ? 0 : p < 0.24 ? (p - 0.10) / 0.14 : p < 0.76 ? 1 : p < 0.90 ? 1 - (p - 0.76) / 0.14 : 0;
                boltNode.rotation.y = -boltLift * 1.05; boltNode.position.y = -pullBack * 7.5;
            }
            if (p >= 1) {
                isBoltCycling = false;
                if (boltNode) { boltNode.rotation.y = 0; boltNode.position.y = 0; }
                if (wasRMBHeldDuringBolt && !isReloading && !isDead) { isADS = true; adsStartTime = performance.now(); }
            }
        }

        mouseSwayX = THREE.MathUtils.lerp(mouseSwayX, targetMouseSwayX, delta * 18);
        mouseSwayY = THREE.MathUtils.lerp(mouseSwayY, targetMouseSwayY, delta * 18);
        targetMouseSwayX = THREE.MathUtils.lerp(targetMouseSwayX, 0, delta * 22);
        targetMouseSwayY = THREE.MathUtils.lerp(targetMouseSwayY, 0, delta * 22);

        const horizSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        lastHorizSpeed = horizSpeed;
        if (horizSpeed > 0.5 && isGrounded && !isSliding && !isVaulting) walkTime += delta * (isSprinting ? 15 : 9);
        else walkTime = THREE.MathUtils.lerp(walkTime, 0, delta * 5);

        const bobX = Math.sin(walkTime) * (isSprinting ? 0.022 : 0.011) * (isADS ? 0.15 : 1.0);
        const bobY = Math.cos(walkTime * 2) * (isSprinting ? 0.018 : 0.008) * (isADS ? 0.15 : 1.0);
        const sprintCarryAngle = (isSprinting && horizSpeed > 2 && !isADS && !isBoltCycling) ? Math.PI / 7 : 0;
        const sprintCarryX = (isSprinting && horizSpeed > 2 && !isADS && !isBoltCycling) ? 0.05 : 0;
        const slideGunTiltZ = (isSliding && !isADS) ? 0.32 : 0;
        const slideGunOffsetY = (isSliding && !isADS) ? -0.05 : 0;

        const recoilPos = recoilPosSpring.update(delta);
        const recoilRot = recoilRotSpring.update(delta);
        const camRecoil = cameraRecoilSpring.update(delta);

        const adsK = isADS ? 0.5 : 1.0;
        const adsTuneData = customGunMesh && customGunMesh.userData ? customGunMesh.userData : {};
        const adsAimY = adsTuneData.adsAimY ?? 0.10;
        const adsX = isADS ? (adsTuneData.adsX ?? 0) : 0;
        const adsZ = isADS ? (adsTuneData.adsZ ?? -0.25) : -0.25;
        const adsSightLock = isADS ? 0.35 : 1.0;

        const targetBaseX = (isADS ? adsX : 0.2) + sprintCarryX + boltOffsetX + bobX - mouseSwayX * adsK;
        const targetBaseY = (isADS ? -adsAimY : -0.22) + landingDip + slideGunOffsetY + boltOffsetY + bobY - mouseSwayY * adsK;
        const targetBaseZ = (isADS ? adsZ : -0.4) + boltOffsetZ;

        const targetRotX = mouseSwayY * 1.5 * adsK + Math.cos(walkTime * 2) * 0.02 * adsK + sprintCarryAngle + boltRotX;
        const targetRotY = mouseSwayX * 1.5 * adsK + Math.sin(walkTime) * 0.03 * adsK - sprintCarryAngle * 0.6 + boltRotY;
        const targetRotZ = -bobX * 1.5 - mouseSwayX * 2.2 * adsK + cameraRoll * 0.8 * adsK + slideGunTiltZ + boltRotZ;

        gunBasePosX = THREE.MathUtils.lerp(gunBasePosX, targetBaseX, delta * 14);
        gunBasePosY = THREE.MathUtils.lerp(gunBasePosY, targetBaseY, delta * 14);
        gunBasePosZ = THREE.MathUtils.lerp(gunBasePosZ, targetBaseZ, delta * 16);
        gunBaseRotX = THREE.MathUtils.lerp(gunBaseRotX, targetRotX, delta * 16);
        gunBaseRotY = THREE.MathUtils.lerp(gunBaseRotY, targetRotY, delta * 14);
        gunBaseRotZ = THREE.MathUtils.lerp(gunBaseRotZ, targetRotZ, delta * 14);

        const recRotX = recoilRot.x * adsSightLock;
        const recRotY = recoilRot.y * adsSightLock;
        const recRotZ = recoilRot.z * (isADS ? 0.55 : 1.0);
        const recPosZ = recoilPos.z * (isADS ? 0.75 : 1.0);
        const recoilOffsetX = isADS ? (gunBasePosZ * recRotY) : recoilPos.x;
        const recoilOffsetY = isADS ? (-gunBasePosZ * recRotX) : (recoilPos.y + recoilRot.x * 0.03);

        gunGroup.position.set(gunBasePosX + recoilOffsetX + meleeOffset.pos.x + inspectOffset.pos.x, gunBasePosY + recoilOffsetY + meleeOffset.pos.y + inspectOffset.pos.y, gunBasePosZ + recPosZ + meleeOffset.pos.z + inspectOffset.pos.z);
        gunGroup.rotation.set(gunBaseRotX + recRotX + meleeOffset.rot.x + inspectOffset.rot.x, gunBaseRotY + recRotY + meleeOffset.rot.y + inspectOffset.rot.y, gunBaseRotZ + recRotZ + meleeOffset.rot.z + inspectOffset.rot.z);

        landingDip = THREE.MathUtils.lerp(landingDip, 0, delta * 8);
        const targetRoll = isSliding ? -0.075 : (-direction.x * (isSprinting ? 0.04 : 0.02));
        cameraRoll = THREE.MathUtils.lerp(cameraRoll, targetRoll, delta * 8);
        camera.rotation.z = cameraRoll + camRecoil.z;

        const isSniperOverlay = ATTACHMENTS.scope[currentLoadout.scope]?.useSniperOverlay;
        const scopeActive = isADS && !isBoltCycling && isSniperOverlay && (performance.now() - adsStartTime) >= SNIPER_SCOPE_DELAY_MS;
        const scopeLens = document.querySelector('#sniper-scope .scope-lens');
        const breathBar = document.getElementById('breath-bar');
        const breathPrompt = document.getElementById('breath-prompt');

        if (scopeActive) {
            gunGroup.visible = false; document.getElementById('sniper-scope').style.opacity = '1';
            if (shiftHeld && !breathExhausted && breathStamina > 0) {
                isHoldingBreath = true; breathStamina = Math.max(0, breathStamina - delta / MAX_BREATH_DURATION);
                if (breathStamina <= 0) { breathExhausted = true; isHoldingBreath = false; }
            } else {
                isHoldingBreath = false; breathStamina = Math.min(1.0, breathStamina + delta * 0.45);
                if (breathExhausted && breathStamina >= 0.35) breathExhausted = false;
            }
            const breathFreq = breathExhausted ? 3.8 : 1.65;
            const breathAmp = isHoldingBreath ? 0.0002 : (breathExhausted ? 0.0085 : 0.0038);
            if (!isHoldingBreath) breathTime += delta * breathFreq;
            const targetBreathX = Math.sin(breathTime) * breathAmp;
            const targetBreathY = Math.cos(breathTime * 2) * breathAmp * 0.85;
            prevBreathOffsetX = THREE.MathUtils.lerp(prevBreathOffsetX, targetBreathX, delta * 8);
            prevBreathOffsetY = THREE.MathUtils.lerp(prevBreathOffsetY, targetBreathY, delta * 8);
            if (scopeLens) {
                const pxX = prevBreathOffsetX * 2600, pxY = -prevBreathOffsetY * 2600;
                const breathScale = 1 + Math.sin(breathTime * 2) * (isHoldingBreath ? 0.001 : 0.012);
                scopeLens.style.transform = `translate(${pxX.toFixed(1)}px, ${pxY.toFixed(1)}px) scale(${breathScale.toFixed(4)})`;
            }
            if (breathBar) { breathBar.style.width = `${Math.round(breathStamina * 100)}%`; breathBar.style.background = breathExhausted ? '#ef4444' : (isHoldingBreath ? '#22c55e' : '#38bdf8'); }
            if (breathPrompt) { breathPrompt.innerText = breathExhausted ? 'CATCHING BREATH...' : (isHoldingBreath ? 'STEADYING AIM' : '[SHIFT] HOLD BREATH'); }
        } else {
            gunGroup.visible = true; document.getElementById('sniper-scope').style.opacity = '0';
            isHoldingBreath = false; prevBreathOffsetX = 0; prevBreathOffsetY = 0;
            breathStamina = Math.min(1.0, breathStamina + delta * 0.55);
            if (breathExhausted && breathStamina >= 0.35) breathExhausted = false;
            if (scopeLens) scopeLens.style.transform = 'translate(0px, 0px) scale(1)';
        }

        controls.pitchObject.rotation.x = THREE.MathUtils.clamp(basePitch + camRecoil.x + prevBreathOffsetY, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
        controls.yawObject.rotation.y = baseYaw + camRecoil.y + prevBreathOffsetX;

        const baseFOV = gameSettings.fov || 78; let targetFOV = baseFOV;
        const scopeConfig = ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron;
        if (isADS && !isBoltCycling) {
            const mult = scopeConfig.fovMultiplier || 0.7;
            targetFOV = baseFOV * mult * (isHoldingBreath ? 0.92 : 1.0);
        } else if (isSliding) targetFOV = baseFOV + 14;
        else if (isSprinting && horizSpeed > 2) targetFOV = baseFOV + 12;
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, delta * 10); camera.updateProjectionMatrix();

        const ch = document.getElementById('crosshair'); if (ch) ch.style.opacity = (isADS || inspectState.weight > 0.05) ? '0' : '1';
        crosshairBloomSpring.update(delta); updateCrosshairVisuals(); updateMatchTimerHUD(delta);
        crosshairSpread = THREE.MathUtils.lerp(crosshairSpread, 0, delta * 10);
        if (!window.isMouseDown) continuousShots = Math.max(0, continuousShots - delta * 40);

        const curEyeH = eyeHeightSpring.update(delta);
        const playerObj = controls.getObject();

        if (isVaulting) {
            vaultTimer += delta;
            const t = Math.min(1, vaultTimer / VAULT_DURATION);
            const smoothT = t * t * (3 - 2 * t);
            playerObj.position.lerpVectors(vaultStartPos, vaultEndPos, smoothT);
            playerObj.position.y += Math.sin(t * Math.PI) * 0.25;
            if (t >= 1) { isVaulting = false; playerStance = 'STAND'; isGrounded = true; velocity.set(0, 0, 0); }
        } else {
            if (isSliding) {
                slideTimer -= delta;
                const slideDecay = Math.max(0.25, slideTimer / SLIDE_DURATION);
                velocity.x = slideVel.x * slideDecay; velocity.z = slideVel.z * slideDecay; velocity.y -= 9.8 * 3.2 * delta;
                if (slideTimer <= 0 || !isGrounded) { isSliding = false; playerStance = 'STAND'; eyeHeightSpring.setTarget(1.6); if (shiftHeld && !isADS) isSprinting = true; }
            } else {
                velocity.x -= velocity.x * 10.0 * delta; velocity.z -= velocity.z * 10.0 * delta; velocity.y -= 9.8 * 3.2 * delta;
                direction.z = Number(moveState.forward) - Number(moveState.backward);
                direction.x = Number(moveState.right) - Number(moveState.left); direction.normalize();
                const stockSpeedMod = ATTACHMENTS.stock[currentLoadout.stock]?.speedMod || 1.0;
                const stanceSpeed = isSprinting ? 115.0 : (playerStance === 'CROUCH' ? 28.0 : (playerStance === 'PRONE' ? 14.0 : 62.0));
                const baseSpeed = stanceSpeed * stockSpeedMod * (isADS ? (typeof ADS_MOVE_MULT === 'number' ? ADS_MOVE_MULT : 0.7) : 1);
                if (moveState.forward || moveState.backward) velocity.z -= direction.z * baseSpeed * delta;
                if (moveState.left || moveState.right) velocity.x -= direction.x * baseSpeed * delta;
            }
            playerObj.translateX(-velocity.x * delta); playerObj.translateZ(velocity.z * delta); playerObj.position.y += velocity.y * delta;
            resolveRadialCollisions(playerObj, curEyeH);
            const footProbe = new THREE.Vector3(playerObj.position.x, playerObj.position.y - curEyeH + 0.65, playerObj.position.z);
            vaultRay.set(footProbe, new THREE.Vector3(0, -1, 0)); vaultRay.near = 0; vaultRay.far = 0.85;
            const groundHits = vaultRay.intersectObjects(collidableObjects, false);
            const floorY = groundHits.length > 0 ? groundHits[0].point.y : 0;
            if (playerObj.position.y <= floorY + curEyeH && velocity.y <= 0.1) {
                if (!isGrounded) { landingDip = -0.08; isGrounded = true; }
                velocity.y = 0; playerObj.position.y = floorY + curEyeH; canJump = true;
            } else if (playerObj.position.y < curEyeH) {
                if (!isGrounded) landingDip = -0.08; isGrounded = true;
                velocity.y = 0; playerObj.position.y = curEyeH; canJump = true;
            } else if (groundHits.length === 0 && playerObj.position.y > curEyeH + 0.15) { isGrounded = false; }
        }
        const edge = MAP_IS_CUSTOM ? 0.5 : -2;
        playerObj.position.x = Math.max(MAP_BOUNDS.minX + edge, Math.min(MAP_BOUNDS.maxX - edge, playerObj.position.x));
        playerObj.position.z = Math.max(MAP_BOUNDS.minZ + edge, Math.min(MAP_BOUNDS.maxZ - edge, playerObj.position.z));
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
    updateLoadoutUI();
    updateHealthHUD();
    updateMatchStatusHUD();
    animate();
};

/* --- Loadout screen: weapon readout (class, name, stat bars, equipped labels) --- */
function renderLoadoutInfo(w) {
    const set = (id, t) => { const e = document.getElementById(id); if (e) e.innerText = t; };
    const card = document.querySelector('.weapon-card[data-weapon="' + currentWeaponKey + '"]');
    const grp = card && card.closest('[data-class]');
    set('lo-class', grp ? grp.dataset.class : ''); set('lo-name', w.name);
    set('eq-primary', WEAPONS[selectedPrimaryKey].name); set('eq-secondary', WEAPONS[selectedSecondaryKey].name); set('eq-melee', WEAPONS.bayonet.name);
    const isMelee = w.type === 'MELEE';
    const att = document.getElementById('attach-section'); if (att) att.classList.toggle('hidden', isMelee);
    const stats = document.getElementById('lo-stats'); if (!stats) return;
    const rows = isMelee
        ? [['Damage', w.damage, 120, w.damage], ['Reach', w.range0, 4, w.range0 + ' m'], ['Speed', w.fireRate, 600, w.fireRate + ' rpm']]
        : [['Damage', w.damage, 120, w.damage], ['Range', w.range1, 180, w.range1 + ' m'], ['Fire rate', w.fireRate, 1000, w.fireRate + ' rpm'], ['Magazine', getMaxClipFor(currentWeaponKey), 200, getMaxClipFor(currentWeaponKey)]];
    stats.innerHTML = rows.map(r => '<div class="stat"><span>' + r[0] + '</span><i><u style="width:' + Math.min(100, r[1] / r[2] * 100).toFixed(0) + '%"></u></i><b>' + r[3] + '</b></div>').join('');
}
