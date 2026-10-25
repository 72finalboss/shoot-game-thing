/* audio.js — all game audio (pooled HTML5 audio + Web Audio UI feedback) */

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
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

function setMasterVolume(vol) {
    gameSettings.volume = Math.max(0, Math.min(1, vol));
    if (masterGain && audioCtx) masterGain.gain.setValueAtTime(gameSettings.volume, audioCtx.currentTime);
}

/* ============================================================================
   SOUND ASSET PATHS — Insert / edit your sound file paths here
   ============================================================================ */
const SOUNDS = {
    // 1. Shoot sounds
    shoot_m4:  'sounds/shoot/m4a1_shoot.mp3',
    shoot_awp: 'sounds/shoot/awp_shoot.mp3',
    shoot_mp5: 'sounds/shoot/mp5_shoot.mp3',

    // 2. Reload sounds (clip out, clip in, clip hit)
    reload: {
        // Default reload paths (used if a per-weapon path below is left empty '')
        clip_out: 'sounds/reload/awp_clipout.mp3',
        clip_in:  'sounds/reload/awp_clipin.mp3',
        clip_hit: 'sounds/reload/awp_cliphit.mp3',

        // Per-weapon reload sound overrides
        m4a1: {
            clip_out: 'sounds/reload/m4a1_clipout.mp3',
            clip_in:  'sounds/reload/m4a1_clipin.mp3',
            clip_hit: 'sounds/reload/m4a1_cliphit.mp3'
        },
        AWP: {
            clip_out: 'sounds/reload/awp_clipout.mp3',
            clip_in:  'sounds/reload/awp_clipin.mp3',
            clip_hit: 'sounds/reload/awp_cliphit.mp3'
        },
        mp5: {
            clip_out: 'sounds/reload/mp5_clipout.mp3',
            clip_in:  'sounds/reload/mp5_clipin.mp3',
            clip_hit: 'sounds/reload/mp5_cliphit.mp3'
        }
    },

    // 3. Bolt / Slide sounds (backward, forward)
    // Plays after reloading for M4A1/MP5, and during bolt-action cycling for AWP
    bolt: {
        // Default bolt paths (used if a per-weapon path below is left empty '')
        backward: 'sounds/bolt-action/awp_boltback.mp3',
        forward:  'sounds/bolt-action/awp_boltforward.mp3',

        // Per-weapon bolt / slide sound paths
        m4a1: {
            backward: 'sounds/bolt-action/m4a1_boltback.wav',
            forward:  'sounds/bolt-action/m4a1_boltforward.wav'
        },
        AWP: {
            backward: 'sounds/bolt-action/awp_boltback.mp3',
            forward:  'sounds/bolt-action/awp_boltforward.mp3'
        },
        mp5: {
            backward: 'sounds/bolt-action/mp5_slideback.wav',
            forward:  'sounds/bolt-action/mp5_slideforward.wav'
        }
    }
};

/* Exact GLB animation keyframe timestamps (in seconds) for each weapon's reload */
const RELOAD_SOUND_TIMINGS = {
    // m4a1.glb (3.08s): mag out 0.04-0.63s, mag in 1.25-2.00s (enters at ~1.72s, seats at 2.00s), bolt pull 2.54-2.92s, bolt release 2.92-3.08s
    m4a1: {
        clip_out:  0.18,
        clip_in:   1.72,
        clip_hit:  1.98,
        bolt_back: 2.62,
        bolt_fwd:  2.92
    },
    // mp5.glb (1.79s): mag out 0.04-0.50s, mag in 0.67-1.25s (enters at ~0.80s, seats at 1.25s), slide pull 1.50-1.75s, slide release 1.75-1.79s
    mp5: {
        clip_out:  0.12,
        clip_in:   0.80,
        clip_hit:  1.20,
        bolt_back: 1.54,
        bolt_fwd:  1.74
    },
    // AWP.glb (2.50s): mag out 0.04-0.83s, mag in 1.33-2.25s, mag slap 2.29-2.50s
    AWP: {
        clip_out:  0.20,
        clip_in:   1.95,
        clip_hit:  2.29
    }
};

/* --- Audio pool: prevents rapid fire from cutting the sound off --- */
const audioPool = {};
function getAudio(src, poolSize = 4) {
    if (!src) return null;
    if (!audioPool[src]) {
        audioPool[src] = [];
        for (let i = 0; i < poolSize; i++) {
            const a = new Audio(src);
            a.preload = 'auto';
            audioPool[src].push(a);
        }
    }
    const pool = audioPool[src];
    for (let a of pool) {
        if (a.paused || a.ended) { a.currentTime = 0; return a; }
    }
    pool[0].currentTime = 0;
    return pool[0];
}

function playSound(src, baseVolume = 1.0) {
    if (!src) return;
    try {
        const a = getAudio(src);
        if (!a) return;
        a.volume = Math.max(0, Math.min(1, baseVolume * gameSettings.volume));
        a.play().catch(() => {});
    } catch (err) {}
}

/* --- 1. SHOOT --- */
function playGunshotSound(type = 'm4a1') {
    let src = SOUNDS.shoot_m4;
    if (type === 'AWP') src = SOUNDS.shoot_awp;
    else if (type === 'mp5') src = SOUNDS.shoot_mp5;

    let vol = 0.8;
    if (typeof currentLoadout !== 'undefined' && currentLoadout.muzzle === 'suppressor') vol = 0.4;
    playSound(src, vol);
}

/* --- 2. RELOAD (clip_out, clip_in, clip_hit + post-reload bolt backward/forward) --- */
let _reloadSoundTimers = [];

function cancelReloadSounds() {
    while (_reloadSoundTimers.length) {
        clearTimeout(_reloadSoundTimers.pop());
    }
}

function getReloadSoundPath(stage, weaponKey) {
    const w = weaponKey || (typeof currentWeaponKey !== 'undefined' ? currentWeaponKey : 'm4a1');
    const perWeapon = SOUNDS.reload && SOUNDS.reload[w] && SOUNDS.reload[w][stage];
    if (perWeapon) return perWeapon;
    return (SOUNDS.reload && SOUNDS.reload[stage]) || '';
}

function getBoltSoundPath(stage, weaponKey) {
    const w = weaponKey || (typeof currentWeaponKey !== 'undefined' ? currentWeaponKey : 'AWP');
    const perWeapon = SOUNDS.bolt && SOUNDS.bolt[w] && SOUNDS.bolt[w][stage];
    if (perWeapon) return perWeapon;
    return (SOUNDS.bolt && SOUNDS.bolt[stage]) || '';
}

function playReloadClipOutSound(weaponKey) {
    playSound(getReloadSoundPath('clip_out', weaponKey), 0.75);
}

function playReloadClipInSound(weaponKey) {
    playSound(getReloadSoundPath('clip_in', weaponKey), 0.75);
}

function playReloadClipHitSound(weaponKey) {
    playSound(getReloadSoundPath('clip_hit', weaponKey), 0.80);
}

function playBoltBackSound(weaponKey) {
    playSound(getBoltSoundPath('backward', weaponKey), 0.75);
}

function playBoltForwardSound(weaponKey) {
    playSound(getBoltSoundPath('forward', weaponKey), 0.75);
}

function playReloadSound(weaponKey, reloadMs = 2500) {
    cancelReloadSounds();
    const w = weaponKey || (typeof currentWeaponKey !== 'undefined' ? currentWeaponKey : 'm4a1');
    const t = RELOAD_SOUND_TIMINGS[w] || RELOAD_SOUND_TIMINGS.m4a1;
    const speed = (typeof weaponAnim !== 'undefined' && weaponAnim && weaponAnim.mixer && weaponAnim.mixer.timeScale) || 1.0;
    const toMs = (sec) => Math.round((sec / speed) * 1000);

    if (t.clip_out != null) {
        _reloadSoundTimers.push(setTimeout(() => playReloadClipOutSound(w), toMs(t.clip_out)));
    }
    if (t.clip_in != null) {
        _reloadSoundTimers.push(setTimeout(() => playReloadClipInSound(w), toMs(t.clip_in)));
    }
    if (t.clip_hit != null) {
        _reloadSoundTimers.push(setTimeout(() => playReloadClipHitSound(w), toMs(t.clip_hit)));
    }
    if (t.bolt_back != null) {
        _reloadSoundTimers.push(setTimeout(() => playBoltBackSound(w), toMs(t.bolt_back)));
    }
    if (t.bolt_fwd != null) {
        _reloadSoundTimers.push(setTimeout(() => playBoltForwardSound(w), toMs(t.bolt_fwd)));
    }
}

/* --- 3. BOLT-ACTION --- */
function playBoltActionSound() {
    // Triggered at the backward/forward stages in startBoltActionSequence()
}

/* --- Hit feedback (synth = zero latency) --- */
function playHitmarkerSound() {
    try {
        initAudioContext(); if (!audioCtx) return;
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(), now = audioCtx.currentTime;
        osc.type = 'sine'; osc.frequency.setValueAtTime(950, now);
        gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.connect(gain); gain.connect(masterGain || audioCtx.destination);
        osc.start(now); osc.stop(now + 0.07);
    } catch (err) {}
}

function playHeadshotSound() {
    try {
        initAudioContext(); if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const o1 = audioCtx.createOscillator(), g1 = audioCtx.createGain();
        o1.type = 'sine'; o1.frequency.setValueAtTime(2600, now);
        o1.frequency.exponentialRampToValueAtTime(1850, now + 0.16);
        g1.gain.setValueAtTime(0.5, now); g1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        o1.connect(g1); g1.connect(masterGain || audioCtx.destination);
        o1.start(now); o1.stop(now + 0.16);
    } catch (err) {}
}
