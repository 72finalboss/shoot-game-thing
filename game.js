/*
 * game.js
 * Three.js engine, player controls/physics, bots, weapon gameplay, and audio.
 * Depends on Three.js + GLTFLoader and loads after gunsLoad.js.
 */

/* Tactical Settings & Preference Management */
        const defaultSettings = {
            fov: 78,
            volume: 1.0,
            sensitivity: 1.0
        };

        let gameSettings = Object.assign({}, defaultSettings);

        try {
            const saved = localStorage.getItem('pf3d_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed.fov === 'number' && !isNaN(parsed.fov)) gameSettings.fov = parsed.fov;
                if (typeof parsed.volume === 'number' && !isNaN(parsed.volume)) gameSettings.volume = parsed.volume;
                if (typeof parsed.sensitivity === 'number' && !isNaN(parsed.sensitivity)) gameSettings.sensitivity = parsed.sensitivity;
            }
        } catch (e) {}

        function saveSettings() {
            try {
                localStorage.setItem('pf3d_settings', JSON.stringify(gameSettings));
            } catch (e) {}
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
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
        }

        function setMasterVolume(vol) {
            gameSettings.volume = Math.max(0, Math.min(1, vol));
            if (masterGain && audioCtx) {
                masterGain.gain.setValueAtTime(gameSettings.volume, audioCtx.currentTime);
            }
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

                // If suppressed, produce a stealthy tactical subsonic pop
                if (currentLoadout && currentLoadout.muzzle === 'suppressor') {
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(420, now);
                    osc.frequency.exponentialRampToValueAtTime(50, now + 0.09);
                    gain.gain.setValueAtTime(0.18, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
                    osc.start(now);
                    osc.stop(now + 0.09);
                    return;
                }

                if (type === 'AWP') {
                    // Massive, thunderous .50 cal sniper gunshot
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(260, now);
                    osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);
                    gain.gain.setValueAtTime(0.55, now);
                    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.45);
                    osc.start(now);
                    osc.stop(now + 0.45);
                } else if (type === 'mp5') {
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(700, now);
                    osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
                    gain.gain.setValueAtTime(0.2, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                    osc.start(now);
                    osc.stop(now + 0.1);
                } else { // m4a1
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(600, now);
                    osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
                    gain.gain.setValueAtTime(0.28, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                    osc.start(now);
                    osc.stop(now + 0.15);
                }
            } catch (err) {
                // Ignore audio context autoplay restriction exceptions
            }
        }

        function playHitmarkerSound() {
            try {
                initAudioContext();
                if (!audioCtx) return;

                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                const now = audioCtx.currentTime;

                osc.type = 'sine';
                osc.frequency.setValueAtTime(950, now);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

                osc.connect(gain);
                gain.connect(masterGain || audioCtx.destination);

                osc.start(now);
                osc.stop(now + 0.07);
            } catch (err) {
                // Ignore audio exceptions
            }
        }

        /* Iconic Crisp Metallic Helmet DINK Headshot Sound FX */
        function playHeadshotSound() {
            try {
                initAudioContext();
                if (!audioCtx) return;
                const now = audioCtx.currentTime;

                // 1. Resonant High Metallic Chime / Dink
                const osc1 = audioCtx.createOscillator();
                const gain1 = audioCtx.createGain();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(2600, now);
                osc1.frequency.exponentialRampToValueAtTime(1850, now + 0.16);
                gain1.gain.setValueAtTime(0.50, now);
                gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
                osc1.connect(gain1);
                gain1.connect(masterGain || audioCtx.destination);
                osc1.start(now);
                osc1.stop(now + 0.16);

                // 2. Sharp High Metallic Overtone Ring
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.type = 'triangle';
                osc2.frequency.setValueAtTime(3600, now);
                osc2.frequency.exponentialRampToValueAtTime(2400, now + 0.12);
                gain2.gain.setValueAtTime(0.35, now);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc2.connect(gain2);
                gain2.connect(masterGain || audioCtx.destination);
                osc2.start(now);
                osc2.stop(now + 0.12);

                // 3. Low Impact Punch / Thump
                const osc3 = audioCtx.createOscillator();
                const gain3 = audioCtx.createGain();
                osc3.type = 'sawtooth';
                osc3.frequency.setValueAtTime(220, now);
                osc3.frequency.exponentialRampToValueAtTime(45, now + 0.06);
                gain3.gain.setValueAtTime(0.35, now);
                gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
                osc3.connect(gain3);
                gain3.connect(masterGain || audioCtx.destination);
                osc3.start(now);
                osc3.stop(now + 0.06);
            } catch (err) {
                // Ignore audio exceptions
            }
        }

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

        // Tactical Arena Lighting
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
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        scene.add(dirLight);

        // First Person Controller Rig
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
            lock: function() {
                try {
                    const promise = document.body.requestPointerLock();
                    if (promise && promise.catch) {
                        promise.catch(() => {});
                    }
                } catch (e) {}
            },
            unlock: function() {
                try {
                    document.exitPointerLock();
                } catch (e) {}
            }
        };

        document.addEventListener('pointerlockchange', () => {
            controls.isLocked = (document.pointerLockElement === document.body);
            const hud = document.getElementById('hud');
            const loadout = document.getElementById('loadout-screen');
            if (controls.isLocked) {
                hud.classList.remove('hidden');
                loadout.classList.add('opacity-0', 'pointer-events-none');
            } else {
                window.isMouseDown = false;
                hud.classList.add('hidden');
                if (!isDead) {
                    loadout.classList.remove('opacity-0', 'pointer-events-none');
                }
            }
        });

        renderer.domElement.addEventListener('click', () => {
            const customizer = document.getElementById('customizer-panel');
            const settingsPanel = document.getElementById('settings-panel');
            const modalsOpen = (customizer && !customizer.classList.contains('hidden')) || (settingsPanel && !settingsPanel.classList.contains('hidden'));
            if (!controls.isLocked && !isDead && !modalsOpen) {
                controls.lock();
            }
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

        const WEAPONS = {
            m4a1: {
                name: 'M4A1 ASSAULT RIFLE',
                damage: 34,
                fireRate: 800, // RPM
                recoilClimb: 0.02,        
                recoilKickH: 0.008,        
                gunKickZ: 0.025,           
                gunRotX: 0.04,             
                spreadBase: 6,
                spreadMax: 28,
                maxClip: 30,
                reserve: 120,
                type: 'PRIMARY',
                color: 0x38bdf8
            },
            AWP: {
                name: 'AWP SNIPER',
                damage: 98,
                fireRate: 46,
                recoilClimb: 0.12,
                recoilKickH: 0.025,
                gunKickZ: 0.09,
                gunRotX: 0.15,
                spreadBase: 12,
                spreadMax: 45,
                maxClip: 5,
                reserve: 25,
                type: 'PRIMARY',
                color: 0xf59e0b
            },
            mp5: {
                name: 'MP5 SUBMACHINE GUN',
                damage: 26,
                fireRate: 900,
                recoilClimb: 0.012, 
                recoilKickH: 0.010, 
                gunKickZ: 0.020,
                gunRotX: 0.035, 
                spreadBase: 8,
                spreadMax: 32,
                maxClip: 30,
                reserve: 120,
                type: 'PRIMARY',
                color: 0x10b981
            }
        };

        let currentWeaponKey = 'm4a1';
        let currentWeapon = WEAPONS.m4a1;
        let ammoClip = currentWeapon.maxClip;
        let ammoReserve = currentWeapon.reserve;

        const collidableObjects = [];
        const arenaSize = 120;

        function buildTacticalMap() {
            // Main Concrete Ground
            const floorGeo = new THREE.PlaneGeometry(arenaSize, arenaSize);
            const floorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.receiveShadow = true;
            scene.add(floor);

            // Tactical Grid Overlay
            const grid = new THREE.GridHelper(arenaSize, 60, 0x0284c7, 0x1e293b);
            grid.position.y = 0.02;
            scene.add(grid);

            // Perimeter Boundary Walls
            const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
            const wallHeight = 12;
            const wallThickness = 2;

            const walls = [
                { size: [arenaSize, wallHeight, wallThickness], pos: [0, wallHeight / 2, -arenaSize / 2] },
                { size: [arenaSize, wallHeight, wallThickness], pos: [0, wallHeight / 2, arenaSize / 2] },
                { size: [wallThickness, wallHeight, arenaSize], pos: [-arenaSize / 2, wallHeight / 2, 0] },
                { size: [wallThickness, wallHeight, arenaSize], pos: [arenaSize / 2, wallHeight / 2, 0] },
            ];

            walls.forEach(w => {
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
                mesh.position.set(...w.pos);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
                collidableObjects.push(mesh);
            });

            // Shipping Containers
            const containerColors = [0x0284c7, 0xe11d48, 0x15803d, 0x475569];
            const containers = [
                { pos: [-15, 2.5, -20], rot: 0, colorIdx: 0 },
                { pos: [-15, 7.5, -20], rot: 0, colorIdx: 1 },
                { pos: [18, 2.5, 15], rot: Math.PI / 2, colorIdx: 2 },
                { pos: [-25, 2.5, 20], rot: Math.PI / 4, colorIdx: 3 },
                { pos: [25, 2.5, -25], rot: -Math.PI / 6, colorIdx: 0 },
            ];

            containers.forEach(c => {
                const mat = new THREE.MeshStandardMaterial({ color: containerColors[c.colorIdx], roughness: 0.4, metalness: 0.3 });
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 14), mat);
                mesh.position.set(...c.pos);
                mesh.rotation.y = c.rot;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
                collidableObjects.push(mesh);
            });

            // Elevated Sniping Towers
            const towerMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
            const towers = [
                { pos: [0, 4, 0], size: [16, 8, 16] },
                { pos: [-35, 6, -35], size: [10, 12, 10] },
                { pos: [35, 6, 35], size: [10, 12, 10] },
            ];

            towers.forEach(t => {
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(...t.size), towerMat);
                mesh.position.set(...t.pos);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
                collidableObjects.push(mesh);
            });
        }
        buildTacticalMap();

        const gunGroup = new THREE.Group();
        camera.add(gunGroup);

        /* Modular Weapon System Definitions */
        const ATTACHMENTS = {
            scope: {
                iron: { name: 'Iron Sights (Fast ADS)', fovMultiplier: 0.75, useSniperOverlay: false },
                reddot: { name: 'Coyote Red Dot Sight', fovMultiplier: 0.60, useSniperOverlay: false },
                acog: { name: 'ACOG 4x Tactical Scope', fovMultiplier: 0.42, useSniperOverlay: false },
                sniper: { name: '8x High-Power Sniper Scope', fovMultiplier: 0.22, useSniperOverlay: true }
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

        const currentLoadout = {
            gun: 'm4a1',
            scope: 'iron',
            muzzle: 'none',
            stock: 'standard',
            mag: 'standard',
            handle: 'none'
        };

        function createProceduralWeapon(gunType = currentLoadout.gun, loadout = currentLoadout) {
            const group = new THREE.Group();

            const gunmetalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.7 });
            const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.85 });
            const polymerMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.2 });
            const factionMat = new THREE.MeshStandardMaterial({
                color: gunType === 'AWP' ? 0xf59e0b : (gunType === 'mp5' ? 0x10b981 : 0x0284c7),
                metalness: 0.8,
                roughness: 0.35
            });
            const lensMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.95, transparent: true, opacity: 0.65 });

            // Base Receiver Geometry & Anchor Points according to gunType
            let barrelTipZ = -0.75;
            let railCenterZ = -0.06;
            let railY = 0.08;
            let stockStartZ = 0.30;
            let magY = -0.12;
            let magZ = -0.08;
            let handleY = -0.065;
            let handleZ = -0.36;

            const useGlbM4 = (gunType === 'm4a1' && !!m4a1Template);
            const useGlbAWP = (gunType === 'AWP' && !!AWPTemplate);
            const useGlbMp5 = (gunType === 'mp5' && !!mp5Template);
            let glbBuild = null;

            if (useGlbAWP) {
                glbBuild = buildAWPGlb(loadout);
                barrelTipZ = -1.10;
                railCenterZ = -0.10;
                railY = 0.095;
                group.add(glbBuild.node);
            } else if (useGlbMp5) {
                glbBuild = buildMp5Glb(loadout);
                barrelTipZ = -0.56;
                railCenterZ = -0.05;
                railY = 0.085;
                group.add(glbBuild.node);
            } else if (useGlbM4) {
                glbBuild = buildM4a1Glb(loadout);
                const flatTop = loadout.scope !== 'iron';
                barrelTipZ = loadout.muzzle === 'none' ? -0.67 : -0.63;
                railCenterZ = 0.0;
                railY = flatTop ? 0.05 : 0.104;
                stockStartZ = 0.22;
                magY = -0.12;
                magZ = -0.08;
                handleY = -0.043;
                handleZ = -0.30;
                group.add(glbBuild.node);
                if (flatTop) {
                    const flatRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.5), darkSteelMat);
                    flatRail.position.set(0, 0.049, -0.12);
                    group.add(flatRail);
                }
            } else if (gunType === 'AWP') {
                barrelTipZ = -1.10;
                railCenterZ = -0.10;
                railY = 0.095;
                stockStartZ = 0.42;
                magY = -0.12;
                magZ = -0.04;
                handleY = -0.07;
                handleZ = -0.50;

                const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.90), polymerMat);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.75, 12), darkSteelMat);
                barrel.rotation.x = Math.PI / 2;
                barrel.position.set(0, 0.02, -0.72);
                group.add(body, barrel);
            } else if (gunType === 'mp5') {
                barrelTipZ = -0.56;
                railCenterZ = -0.05;
                railY = 0.085;
                stockStartZ = 0.24;
                magY = -0.11;
                magZ = -0.06;
                handleY = -0.06;
                handleZ = -0.30;

                const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.48), gunmetalMat);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.32, 12), darkSteelMat);
                barrel.rotation.x = Math.PI / 2;
                barrel.position.set(0, 0.02, -0.40);
                group.add(body, barrel);
            } else {
                const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.60), gunmetalMat);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 12), darkSteelMat);
                barrel.rotation.x = Math.PI / 2;
                barrel.position.set(0, 0.02, -0.52);
                group.add(body, barrel);
            }

            // 2. MODULAR PART: MUZZLE ATTACHMENT
            const muzzleType = loadout.muzzle || 'none';
            if (muzzleType === 'suppressor') {
                const can = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.28, 14), darkSteelMat);
                can.rotation.x = Math.PI / 2;
                can.position.set(0, 0.02, barrelTipZ - 0.14);
                group.add(can);
            } else if (muzzleType === 'compensator') {
                const comp = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.10), factionMat);
                comp.position.set(0, 0.02, barrelTipZ - 0.05);
                group.add(comp);
            } else if (muzzleType === 'brake') {
                const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.12, 8), darkSteelMat);
                brake.rotation.x = Math.PI / 2;
                brake.position.set(0, 0.02, barrelTipZ - 0.06);
                group.add(brake);
            } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
                const hider = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.018, 0.06, 8), darkSteelMat);
                hider.rotation.x = Math.PI / 2;
                hider.position.set(0, 0.02, barrelTipZ - 0.03);
                group.add(hider);
            }

            // 3. MODULAR PART: OPTIC / SCOPE
            const scopeType = loadout.scope || 'iron';
            const opticGroup = new THREE.Group();
            opticGroup.name = 'optic';
            group.userData.adsAimY = railY + (scopeType === 'iron' ? 0.06 : 0.055);
            group.userData.scopeType = scopeType;
            if (useGlbM4 && scopeType === 'iron') group.userData.adsAimY = M4A1_IRON_AIM_Y;

            if (scopeType === 'reddot') {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.10), darkSteelMat);
                base.position.set(0, railY + 0.012, railCenterZ);
                const hood = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.12), gunmetalMat);
                hood.position.set(0, railY + 0.05, railCenterZ);
                const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.04), lensMat);
                glass.position.set(0, railY + 0.05, railCenterZ);
                const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 6), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
                dot.position.set(0, railY + 0.05, railCenterZ - 0.01);
                opticGroup.add(base, hood, glass, dot);
            } else if (scopeType === 'acog') {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.14), darkSteelMat);
                base.position.set(0, railY + 0.015, railCenterZ);
                const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 0.24, 12), gunmetalMat);
                tube.rotation.x = Math.PI / 2;
                tube.position.set(0, railY + 0.055, railCenterZ);
                const fiber = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.01, 0.14), factionMat);
                fiber.position.set(0, railY + 0.095, railCenterZ);
                const frontLens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12), lensMat);
                frontLens.position.set(0, railY + 0.055, railCenterZ - 0.12);
                opticGroup.add(base, tube, fiber, frontLens);
            } else if (scopeType === 'sniper') {
                const mount1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.03), darkSteelMat);
                mount1.position.set(0, railY + 0.02, railCenterZ - 0.08);
                const mount2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.03), darkSteelMat);
                mount2.position.set(0, railY + 0.02, railCenterZ + 0.08);

                const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.44, 16), darkSteelMat);
                tube.rotation.x = Math.PI / 2;
                tube.position.set(0, railY + 0.065, railCenterZ);

                const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.032, 0.12, 16), factionMat);
                bell.rotation.x = Math.PI / 2;
                bell.position.set(0, railY + 0.065, railCenterZ - 0.24);

                const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.025, 8), factionMat);
                turret.position.set(0, railY + 0.105, railCenterZ);

                opticGroup.add(mount1, mount2, tube, bell, turret);
            } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
                const rear = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.02), darkSteelMat);
                rear.position.set(0, railY + 0.02, railCenterZ + 0.12);
                const front = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.02), factionMat);
                front.position.set(0, railY + 0.02, barrelTipZ + 0.08);
                opticGroup.add(rear, front);
            }
            group.add(opticGroup);

            // 4. MODULAR PART: TACTICAL STOCK
            const stockType = loadout.stock || 'standard';
            if (stockType === 'skeletal') {
                const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.22), factionMat);
                stock.position.set(0, -0.01, stockStartZ + 0.11);
                group.add(stock);
            } else if (stockType === 'heavy') {
                const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.18, 0.28), polymerMat);
                stock.position.set(0, -0.02, stockStartZ + 0.14);
                const riser = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.16), factionMat);
                riser.position.set(0, 0.085, stockStartZ + 0.12);
                group.add(stock, riser);
            } else if (stockType === 'folded') {
                const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), darkSteelMat);
                hinge.position.set(0, -0.01, stockStartZ + 0.02);
                group.add(hinge);
            } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
                const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.20, 10), darkSteelMat);
                tube.rotation.x = Math.PI / 2;
                tube.position.set(0, 0, stockStartZ + 0.10);
                const butt = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.15, 0.16), polymerMat);
                butt.position.set(0, -0.02, stockStartZ + 0.18);
                group.add(tube, butt);
            }

            // 5. MODULAR PART: MAGAZINE
            const magType = loadout.mag || 'standard';
            const magGroup = new THREE.Group();
            magGroup.name = 'procmag';
            if (magType === 'extended') {
                const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.35, 0.09), darkSteelMat);
                mag.position.set(0, magY - 0.06, magZ - 0.02);
                mag.rotation.x = 0.25;
                magGroup.add(mag);
            } else if (magType === 'drum') {
                const neck = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.07), darkSteelMat);
                neck.position.set(0, magY, magZ);
                const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.09, 16), factionMat);
                drum.rotation.z = Math.PI / 2;
                drum.position.set(0, magY - 0.09, magZ - 0.02);
                magGroup.add(neck, drum);
            } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
                const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.22, 0.085), polymerMat);
                mag.position.set(0, magY, magZ);
                mag.rotation.x = 0.2;
                magGroup.add(mag);
            }
            group.add(magGroup);

            // 6. MODULAR PART: HANDLE / FOREGRIP
            const handleType = loadout.handle || 'none';
            if (handleType === 'vertical') {
                const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, 0.16, 10), darkSteelMat);
                grip.position.set(0, handleY - 0.08, handleZ);
                group.add(grip);
            } else if (handleType === 'angled') {
                const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.15), factionMat);
                grip.position.set(0, handleY - 0.03, handleZ);
                grip.rotation.x = -0.4;
                group.add(grip);
            } else if (handleType === 'stubby') {
                const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.09, 10), polymerMat);
                grip.position.set(0, handleY - 0.045, handleZ);
                group.add(grip);
            } else if (!useGlbAWP && !useGlbMp5 && !useGlbM4) {
                const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.20), darkSteelMat);
                rail.position.set(0, handleY, handleZ);
                group.add(rail);
            }

            // Enable shadows on all child meshes
            group.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            if (glbBuild) {
                weaponAnim = glbBuild.anim;
                weaponAnim.procMag = weaponAnim.glbMag ? null : magGroup;
            }

            return group;
        }

        function rebuildWeaponMesh() {
            weaponAnim = null;
            gunGroup.clear();
            customGunMesh = createProceduralWeapon(currentLoadout.gun, currentLoadout);
            gunGroup.add(customGunMesh);
        }

        rebuildWeaponMesh();
        gunGroup.position.set(0.2, -0.22, -0.4);

        class Bot {
            constructor(name, startPos) {
                this.name = name;
                this.kills = 0;
                this.deaths = 0;
                this.score = 0;
                this.health = 100;
                this.mesh = new THREE.Group();
                this.buildMesh();
                this.mesh.position.copy(startPos);
                scene.add(this.mesh);

                this.targetPos = this.getRandomTarget();
                this.lastShotTime = 0;
            }

            buildMesh() {
                this.mesh.clear();
                // Torso / Body (ends at y = 1.30)
                const body = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.55, 0.50, 1.30, 12),
                    new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 })
                );
                body.position.y = 0.65;
                body.castShadow = true;
                body.userData.isHead = false;

                // Tactical Neck Joint
                const neck = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.20, 0.22, 0.10, 8),
                    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 })
                );
                neck.position.set(0, 1.33, 0);
                neck.userData.isHead = false;

                // Armored Head Unit (y = 1.35 to 1.78)
                const head = new THREE.Mesh(
                    new THREE.BoxGeometry(0.48, 0.42, 0.48),
                    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.4 })
                );
                head.position.set(0, 1.56, 0);
                head.castShadow = true;
                head.userData.isHead = true;

                // Glowing Cyan Visor Sensor
                const visor = new THREE.Mesh(
                    new THREE.BoxGeometry(0.42, 0.15, 0.12),
                    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
                );
                visor.position.set(0, 1.60, -0.25);
                visor.userData.isHead = true;

                this.mesh.add(body, neck, head, visor);
            }

            getRandomTarget() {
                return new THREE.Vector3(
                    (Math.random() - 0.5) * (arenaSize - 20),
                    0.9,
                    (Math.random() - 0.5) * (arenaSize - 20)
                );
            }

            update(delta, playerPos) {
                if (this.health <= 0) return;

                const dir = new THREE.Vector3().subVectors(this.targetPos, this.mesh.position);
                dir.y = 0;
                if (dir.length() < 3) {
                    this.targetPos = this.getRandomTarget();
                } else {
                    dir.normalize();
                    this.mesh.position.addScaledVector(dir, 5.5 * delta);
                    const lookTarget = new THREE.Vector3(this.targetPos.x, this.mesh.position.y, this.targetPos.z);
                    if (this.mesh.position.distanceToSquared(lookTarget) > 0.001) {
                        this.mesh.lookAt(lookTarget);
                    }
                }

                const dist = this.mesh.position.distanceTo(playerPos);
                if (dist < 32) {
                    const playerLookTarget = new THREE.Vector3(playerPos.x, this.mesh.position.y, playerPos.z);
                    if (this.mesh.position.distanceToSquared(playerLookTarget) > 0.001) {
                        this.mesh.lookAt(playerLookTarget);
                    }
                    const now = performance.now();
                    if (now - this.lastShotTime > 1200) {
                        this.shootAtPlayer(playerPos);
                        this.lastShotTime = now;
                    }
                }
            }

            shootAtPlayer(playerPos) {
                playGunshotSound('mp5');
                createLaserBeam(this.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), playerPos, 0xf97316);
                if (Math.random() < 0.3) damagePlayer(12, this);
            }

            takeDamage(amount, isHeadshot = false, hitPoint = null) {
                this.health -= amount;
                if (isHeadshot) {
                    playHeadshotSound();
                } else {
                    playHitmarkerSound();
                }
                showHitmarker(isHeadshot);

                if (hitPoint) {
                    showDamagePopup(amount, hitPoint, isHeadshot);
                }

                if (this.health <= 0) {
                    this.respawn();
                    this.deaths++;
                    playerScore += isHeadshot ? 150 : 100;
                    teamScorePhantoms += 10;
                    killCount++;
                    document.getElementById('score-phantoms').innerText = teamScorePhantoms;
                    updateKDDisplay();
                    
                    const points = isHeadshot ? "+150 HEADSHOT ELIMINATION (+50 BONUS)" : "+100 ENEMY KILLED";
                    showKillNotification(points);
                    addKillFeedEntry(isHeadshot 
                        ? `PHANTOM-1 [HEADSHOT] ${this.name}`
                        : `PHANTOM-1 eliminated [GHOST] ${this.name}`
                    );
                }
            }

            respawn() {
                this.health = 100;
                this.mesh.position.copy(this.getRandomTarget());
            }
        }

        const bots = [];
        const botNames = ['GHOST-ALPHA', 'GHOST-BRAVO', 'GHOST-CHARLIE', 'GHOST-DELTA'];
        botNames.forEach((name, i) => {
            const spawnPos = new THREE.Vector3((i - 1.5) * 20, 0, -30);
            bots.push(new Bot(name, spawnPos));
        });

        let teamScorePhantoms = 150;
        let teamScoreGhosts = 135;
        let playerScore = 0;
        let lastAttacker = null;

        let isADS = false;
        let isSprinting = false;
        let playerStance = 'STAND';
        let health = 100;
        let isReloading = false;
        let isDead = false;
        let respawnInterval = null;
        let lastShotTime = 0;
        let killCount = 0;
        let deathCount = 0;

        function getMaxClip() {
            const magMod = (ATTACHMENTS.mag[currentLoadout.mag] && ATTACHMENTS.mag[currentLoadout.mag].clipMod) || 1.0;
            return Math.round(currentWeapon.maxClip * magMod);
        }

        function updateLoadoutUI() {
            const weapon = WEAPONS[currentWeaponKey];
            const muzzle = ATTACHMENTS.muzzle[currentLoadout.muzzle] || ATTACHMENTS.muzzle.none;
            const stock = ATTACHMENTS.stock[currentLoadout.stock] || ATTACHMENTS.stock.standard;
            const mag = ATTACHMENTS.mag[currentLoadout.mag] || ATTACHMENTS.mag.standard;
            const handle = ATTACHMENTS.handle[currentLoadout.handle] || ATTACHMENTS.handle.none;

            // Sync select dropdowns
            const opticEl = document.getElementById('optic-select');
            if (opticEl) opticEl.value = currentLoadout.scope;
            const muzzleEl = document.getElementById('muzzle-select');
            if (muzzleEl) muzzleEl.value = currentLoadout.muzzle;
            const stockEl = document.getElementById('stock-select');
            if (stockEl) stockEl.value = currentLoadout.stock;
            const magEl = document.getElementById('mag-select');
            if (magEl) magEl.value = currentLoadout.mag;
            const handleEl = document.getElementById('handle-select');
            if (handleEl) handleEl.value = currentLoadout.handle;

            // Calculate Recoil Control Score (higher is better control, 0-100)
            const baseRecoilScore = currentWeaponKey === 'AWP' ? 28 : (currentWeaponKey === 'mp5' ? 76 : 64);
            const totalClimbMod = (muzzle.recoilClimbMod || 1.0) * (stock.recoilClimbMod || 1.0) * (handle.recoilClimbMod || 1.0);
            const totalKickHMod = (muzzle.recoilKickHMod || 1.0) * (handle.recoilKickHMod || 1.0);
            const avgMod = (totalClimbMod + totalKickHMod) / 2;
            const recoilScore = Math.min(98, Math.max(15, Math.round(baseRecoilScore / avgMod)));

            // Update specs dashboard
            document.getElementById('stat-damage').innerText = weapon.damage;
            document.getElementById('bar-damage').style.width = `${Math.min(100, weapon.damage)}%`;
            document.getElementById('stat-firerate').innerText = weapon.fireRate;
            document.getElementById('bar-firerate').style.width = `${Math.min(100, (weapon.fireRate / 1000) * 100)}%`;
            
            const recoilEl = document.getElementById('stat-recoil');
            if (recoilEl) recoilEl.innerText = recoilScore;
            const barRecoil = document.getElementById('bar-recoil');
            if (barRecoil) barRecoil.style.width = `${recoilScore}%`;

            // Max clip calculation
            const maxClip = getMaxClip();
            ammoClip = Math.min(ammoClip, maxClip);
            document.getElementById('ammo-clip').innerText = ammoClip;
            document.getElementById('weapon-name-hud').innerText = weapon.name;
            document.getElementById('ammo-reserve').innerText = ammoReserve;
            document.getElementById('firemode-hud').innerText = currentWeaponKey === 'AWP' ? 'BOLT' : 'AUTO';
        }

        function switchWeapon(weaponKey) {
            if (isReloading || weaponKey === currentWeaponKey) return;
            currentWeaponKey = weaponKey;
            currentWeapon = WEAPONS[currentWeaponKey];
            currentLoadout.gun = weaponKey;

            ammoClip = getMaxClip();
            ammoReserve = currentWeapon.reserve;

            // Rebuild weapon model
            rebuildWeaponMesh();

            // Cancel ADS on weapon swap & make gun visible
            isADS = false;
            gunGroup.visible = true;
            document.getElementById('sniper-scope').style.opacity = '0';

            updateLoadoutUI();

            // Update loadout screen button highlights
            document.querySelectorAll('.weapon-select-btn').forEach(b => {
                if (b.getAttribute('data-weapon') === weaponKey) {
                    b.classList.remove('bg-slate-900/80', 'border-slate-700');
                    b.classList.add('bg-sky-500/20', 'border-sky-400');
                } else {
                    b.classList.remove('bg-sky-500/20', 'border-sky-400');
                    b.classList.add('bg-slate-900/80', 'border-slate-700');
                }
            });
        }

        // Shared reload routine: plays the GLB reload animation (if the held weapon has one) and refills ammo when it ends
        function startReload() {
            const maxClip = getMaxClip();
            isReloading = true;
            isADS = false;
            gunGroup.visible = true;
            document.getElementById('sniper-scope').style.opacity = '0';
            document.getElementById('ammo-clip').innerText = 'RLD...';
            const reloadMs = playReloadAnimation();   // 1400ms fallback for weapons without an animation
            setTimeout(() => {
                const needed = maxClip - ammoClip;
                const added = Math.min(needed, ammoReserve);
                ammoClip += added;
                ammoReserve -= added;
                document.getElementById('ammo-clip').innerText = ammoClip;
                document.getElementById('ammo-reserve').innerText = ammoReserve;
                isReloading = false;
            }, reloadMs);
        }

        function triggerAutoReload() {
            if (ammoClip <= 0 && ammoReserve > 0 && !isReloading) {
                startReload();
            }
        }

        const moveState = { forward: false, backward: false, left: false, right: false };
        const velocity = new THREE.Vector3();
        const direction = new THREE.Vector3();
        let canJump = false;
        let isGrounded = true;
        const clock = new THREE.Clock();
        const raycaster = new THREE.Raycaster();

        // Advanced Tactical Recoil Physics State
        let recoilVelPitch = 0;
        let recoilVelYaw = 0;
        let recoilGunKickZ = 0;
        let recoilGunRotX = 0;
        let recoilGunRotY = 0;
        let recoilGunRotZ = 0;
        let continuousShots = 0;
        let crosshairSpread = 0;

        let mouseSwayX = 0;
        let mouseSwayY = 0;
        let targetMouseSwayX = 0;
        let targetMouseSwayY = 0;
        let walkTime = 0;
        let landingDip = 0;
        let cameraRoll = 0;

        function updateCrosshairVisuals() {
            const top = document.getElementById('ch-top');
            const bottom = document.getElementById('ch-bottom');
            const left = document.getElementById('ch-left');
            const right = document.getElementById('ch-right');
            const offset = 8 + crosshairSpread * 0.8;
            if (top) top.style.transform = `translate(-50%, -${offset}px)`;
            if (bottom) bottom.style.transform = `translate(-50%, ${offset}px)`;
            if (left) left.style.transform = `translate(-${offset}px, -50%)`;
            if (right) right.style.transform = `translate(${offset}px, -50%)`;
        }

        function createLaserBeam(from, to, colorHex = 0x38bdf8) {
            const distance = from.distanceTo(to);
            if (distance < 0.01) return;
            const geom = new THREE.CylinderGeometry(0.02, 0.02, distance, 6);
            geom.rotateX(Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({ color: colorHex });
            const laser = new THREE.Mesh(geom, mat);
            laser.position.copy(from).add(to).multiplyScalar(0.5);
            laser.lookAt(to);
            scene.add(laser);
            setTimeout(() => {
                scene.remove(laser);
                geom.dispose();
                mat.dispose();
            }, 50);
        }

        function showHitmarker(isHeadshot = false) {
            const hm = document.getElementById('hitmarker');
            if (hm) {
                const lines = hm.querySelectorAll('.hitmark-line');
                lines.forEach(l => {
                    l.style.backgroundColor = isHeadshot ? '#ef4444' : '#ffffff';
                    l.style.boxShadow = isHeadshot ? '0 0 8px #ef4444' : '0 0 4px #ffffff';
                });
                hm.style.transform = isHeadshot ? 'translate(-50%, -50%) rotate(45deg) scale(1.35)' : 'translate(-50%, -50%) rotate(45deg) scale(1.0)';
                hm.style.opacity = '1';
                setTimeout(() => {
                    hm.style.opacity = '0';
                    hm.style.transform = 'translate(-50%, -50%) rotate(45deg) scale(1.0)';
                }, 130);
            }
        }

        function showKillNotification(txt) {
            const el = document.getElementById('kill-notify');
            if (el) {
                el.innerText = txt;
                el.style.opacity = '1';
                setTimeout(() => el.style.opacity = '0', 1800);
            }
        }

        function showDamagePopup(amt, worldPos, isHeadshot = false) {
            const screenPos = worldPos.clone().project(camera);
            if (screenPos.z > 1) return; // Behind camera
            const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

            const popup = document.createElement('div');
            popup.className = 'damage-popup';
            if (isHeadshot) {
                popup.innerText = `CRIT -${amt}`;
                popup.style.color = '#ef4444';
                popup.style.fontSize = '32px';
                popup.style.textShadow = '0 0 10px rgba(239, 68, 68, 0.9)';
            } else {
                popup.innerText = `-${amt}`;
                popup.style.color = '#fbbf24';
            }
            popup.style.left = `${x}px`;
            popup.style.top = `${y}px`;
            document.getElementById('popups-container').appendChild(popup);
            setTimeout(() => popup.remove(), 800);
        }

        function shoot() {
            if (ammoClip <= 0 || isReloading || isDead) return;
            
            const now = performance.now();
            const fireInterval = 60000 / currentWeapon.fireRate;
            if (now - lastShotTime < fireInterval) return;
            lastShotTime = now;

            ammoClip--;
            document.getElementById('ammo-clip').innerText = ammoClip;

            // Auto-reload when empty
            if (ammoClip <= 0) {
                setTimeout(() => triggerAutoReload(), 300);
            }

            playGunshotSound(currentWeaponKey);

            // Attachment recoil modifiers
            const muzzle = ATTACHMENTS.muzzle[currentLoadout.muzzle] || ATTACHMENTS.muzzle.none;
            const stock = ATTACHMENTS.stock[currentLoadout.stock] || ATTACHMENTS.stock.standard;
            const handle = ATTACHMENTS.handle[currentLoadout.handle] || ATTACHMENTS.handle.none;
            const totalClimbMod = (muzzle.recoilClimbMod || 1.0) * (stock.recoilClimbMod || 1.0) * (handle.recoilClimbMod || 1.0);
            const totalKickHMod = (muzzle.recoilKickHMod || 1.0) * (handle.recoilKickHMod || 1.0);

            // Advanced Recoil Physics Calculation
            continuousShots++;
            const sprayFactor = Math.min(2.4, 1.0 + (continuousShots * 0.05));
            const stanceMultiplier = playerStance === 'CROUCH' ? 0.72 : (playerStance === 'PRONE' ? 0.50 : 1.0);
            const adsMultiplier = isADS ? 0.75 : 1.0;

            const climb = currentWeapon.recoilClimb * totalClimbMod * sprayFactor * stanceMultiplier * adsMultiplier;
            const horiz = (Math.random() - 0.48) * currentWeapon.recoilKickH * totalKickHMod * sprayFactor * stanceMultiplier;

            // Punch camera upwards with high-velocity impulse
            recoilVelPitch += climb * 18.0;
            recoilVelYaw += horiz * 15.0;

            // Physical weapon kickback springs
            recoilGunKickZ = Math.min(0.35, recoilGunKickZ + currentWeapon.gunKickZ);
            recoilGunRotX = Math.min(0.65, recoilGunRotX + currentWeapon.gunRotX * totalClimbMod);
            recoilGunRotZ += (Math.random() - 0.5) * 0.08;
            recoilGunRotY += (Math.random() - 0.5) * 0.04;

            // Dynamic Crosshair Bloom
            crosshairSpread = Math.min(38, crosshairSpread + (currentWeaponKey === 'AWP' ? 26 : 7) * totalClimbMod);

            // Scoped visual kick for sniper overlay
            const isSniperOverlay = ATTACHMENTS.scope[currentLoadout.scope]?.useSniperOverlay;
            if (isADS && isSniperOverlay) {
                const scopeEl = document.getElementById('sniper-scope');
                if (scopeEl) {
                    scopeEl.style.transform = `scale(1.08) translate(${(Math.random() - 0.5) * 24}px, -32px)`;
                    setTimeout(() => {
                        scopeEl.style.transform = 'scale(1) translate(0, 0)';
                    }, 130);
                }
            }

            // Camera Raycast Target with dynamic spray spread
            const spreadRad = (crosshairSpread * 0.0008) * (isADS ? 0.15 : 1.0);
            const spreadOffsetX = (Math.random() - 0.5) * spreadRad;
            const spreadOffsetY = (Math.random() - 0.5) * spreadRad;
            raycaster.setFromCamera(new THREE.Vector2(spreadOffsetX, spreadOffsetY), camera);
            const botMeshes = bots.map(b => b.mesh);
            const intersects = raycaster.intersectObjects([...collidableObjects, ...botMeshes], true);

            const muzzlePos = new THREE.Vector3();
            gunGroup.getWorldPosition(muzzlePos);

            if (intersects.length > 0) {
                const hit = intersects[0];
                createLaserBeam(muzzlePos, hit.point, currentWeapon.color);

                let hitBot = null;
                let isHeadshot = false;

                bots.forEach(b => {
                    b.mesh.traverse(child => {
                        if (child === hit.object) {
                            hitBot = b;
                            if (child.userData && child.userData.isHead) {
                                isHeadshot = true;
                            }
                        }
                    });
                });

                if (hitBot) {
                    const hitHeight = hit.point.y - hitBot.mesh.position.y;
                    if (hitHeight >= 1.32) {
                        isHeadshot = true;
                    }
                    const baseDmg = currentWeapon.damage;
                    const dmg = isHeadshot ? Math.round(baseDmg * 2.2) : baseDmg;
                    hitBot.takeDamage(dmg, isHeadshot, hit.point);
                }
            } else {
                const farPoint = new THREE.Vector3();
                raycaster.ray.at(60, farPoint);
                createLaserBeam(muzzlePos, farPoint, currentWeapon.color);
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
                isDead = true;
                deathCount++;
                if (lastAttacker) {
                    lastAttacker.kills++;
                    lastAttacker.score += 100;
                    teamScoreGhosts += 10;
                    const gs = document.getElementById('score-ghosts');
                    if (gs) gs.innerText = teamScoreGhosts;
                    addKillFeedEntry(`[GHOST] ${lastAttacker.name} eliminated PHANTOM-1`);
                    lastAttacker = null;
                }
                updateKDDisplay();
                controls.unlock();
                
                document.getElementById('loadout-screen').classList.add('opacity-0', 'pointer-events-none');
                const respawnScreen = document.getElementById('respawn-screen');
                respawnScreen.classList.remove('hidden');
                
                let timeLeft = 5;
                const timerEl = document.getElementById('respawn-timer');
                const deployBtn = document.getElementById('respawn-deploy-btn');
                
                timerEl.innerText = timeLeft;
                deployBtn.disabled = true;
                deployBtn.className = "w-full py-3.5 bg-slate-800 text-slate-500 font-extrabold text-sm tracking-widest pf-clip-btn border border-slate-700 transition cursor-not-allowed";
                deployBtn.innerText = `DEPLOYING IN ${timeLeft}s`;

                if (respawnInterval) clearInterval(respawnInterval);
                
                respawnInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        timerEl.innerText = timeLeft;
                        deployBtn.innerText = `DEPLOYING IN ${timeLeft}s`;
                    } else {
                        clearInterval(respawnInterval);
                        timerEl.innerText = '0';
                        deployBtn.disabled = false;
                        deployBtn.className = "w-full py-3.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-sm tracking-widest pf-clip-btn shadow-lg shadow-sky-500/30 hover:scale-[1.02] active:scale-95 transition cursor-pointer";
                        deployBtn.innerText = "DEPLOY NOW [SPACE]";
                    }
                }, 1000);

                addKillFeedEntry('PHANTOM-1 KIA - Awaiting Respawn Cooldown');
            }
        }

        function triggerRespawn() {
            isDead = false;
            health = 100;
            ammoClip = getMaxClip();
            ammoReserve = currentWeapon.reserve;
            document.getElementById('hp-bar').style.width = '100%';
            document.getElementById('hp-text').innerText = '100 HP';
            document.getElementById('ammo-clip').innerText = ammoClip;
            document.getElementById('ammo-reserve').innerText = ammoReserve;
            controls.getObject().position.set(0, 1.6, 40);
            isADS = false;
            gunGroup.visible = true;
            document.getElementById('sniper-scope').style.opacity = '0';
            
            document.getElementById('respawn-screen').classList.add('hidden');
            controls.lock();
            addKillFeedEntry('PHANTOM-1 redeployed to combat zone');
        }

        document.getElementById('respawn-deploy-btn').addEventListener('click', () => {
            const btn = document.getElementById('respawn-deploy-btn');
            if (!btn.disabled) {
                triggerRespawn();
            }
        });

        function addKillFeedEntry(msg) {
            const feed = document.getElementById('kill-feed');
            const entry = document.createElement('div');
            entry.className = "pf-panel pf-clip-btn px-3 py-1 text-slate-200 border-l-2 border-sky-400";
            entry.innerText = msg;
            feed.appendChild(entry);
            setTimeout(() => entry.remove(), 4000);
        }

        function updateKDDisplay() {
            const el = document.getElementById('kd-display');
            if (el) el.innerText = `${killCount} / ${deathCount}`;
        }

        // Modular Attachments Event Listeners
        ['optic-select', 'muzzle-select', 'stock-select', 'mag-select', 'handle-select'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', (e) => {
                const val = e.target.value;
                if (id === 'optic-select') currentLoadout.scope = val;
                if (id === 'muzzle-select') currentLoadout.muzzle = val;
                if (id === 'stock-select') currentLoadout.stock = val;
                if (id === 'mag-select') {
                    currentLoadout.mag = val;
                    ammoClip = getMaxClip();
                }
                if (id === 'handle-select') currentLoadout.handle = val;

                rebuildWeaponMesh();
                updateLoadoutUI();
            });
        });

        document.querySelectorAll('.weapon-select-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const weaponKey = e.currentTarget.getAttribute('data-weapon');
                switchWeapon(weaponKey);
            });
        });

        function toggleSettingsModal() {
            const panel = document.getElementById('settings-panel');
            if (!panel) return;
            const isHidden = panel.classList.contains('hidden');
            if (isHidden) {
                document.getElementById('setting-fov').value = gameSettings.fov;
                document.getElementById('val-setting-fov').innerText = `${gameSettings.fov}°`;
                document.getElementById('setting-volume').value = Math.round(gameSettings.volume * 100);
                document.getElementById('val-setting-volume').innerText = `${Math.round(gameSettings.volume * 100)}%`;
                document.getElementById('setting-sens').value = gameSettings.sensitivity;
                document.getElementById('val-setting-sens').innerText = `${gameSettings.sensitivity.toFixed(2)}x`;
                panel.classList.remove('hidden');
                controls.unlock();
            } else {
                panel.classList.add('hidden');
            }
        }

        document.getElementById('setting-fov').addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            gameSettings.fov = val;
            document.getElementById('val-setting-fov').innerText = `${val}°`;
            camera.fov = val;
            camera.updateProjectionMatrix();
            saveSettings();
        });

        document.getElementById('setting-volume').addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            setMasterVolume(val / 100);
            document.getElementById('val-setting-volume').innerText = `${val}%`;
            saveSettings();
        });

        document.getElementById('setting-sens').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            gameSettings.sensitivity = val;
            document.getElementById('val-setting-sens').innerText = `${val.toFixed(2)}x`;
            saveSettings();
        });

        document.getElementById('test-audio-btn').addEventListener('click', () => {
            initAudioContext();
            setMasterVolume(parseInt(document.getElementById('setting-volume').value) / 100);
            playGunshotSound('AWP');
        });

        document.getElementById('reset-settings-btn').addEventListener('click', () => {
            gameSettings = Object.assign({}, defaultSettings);
            document.getElementById('setting-fov').value = defaultSettings.fov;
            document.getElementById('val-setting-fov').innerText = `${defaultSettings.fov}°`;
            document.getElementById('setting-volume').value = Math.round(defaultSettings.volume * 100);
            document.getElementById('val-setting-volume').innerText = `${Math.round(defaultSettings.volume * 100)}%`;
            document.getElementById('setting-sens').value = defaultSettings.sensitivity;
            document.getElementById('val-setting-sens').innerText = `${defaultSettings.sensitivity.toFixed(2)}x`;
            setMasterVolume(defaultSettings.volume);
            camera.fov = defaultSettings.fov;
            camera.updateProjectionMatrix();
            saveSettings();
        });

        document.getElementById('close-settings-btn').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.add('hidden');
        });
        document.getElementById('save-close-settings-btn').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.add('hidden');
        });

        document.getElementById('open-settings-btn').addEventListener('click', () => toggleSettingsModal());
        document.getElementById('open-settings-loadout-btn').addEventListener('click', () => toggleSettingsModal());

        document.getElementById('deploy-btn').addEventListener('click', () => controls.lock());
        document.getElementById('open-loadout-btn').addEventListener('click', () => controls.unlock());
        document.getElementById('open-customizer-btn').addEventListener('click', () => {
            document.getElementById('customizer-panel').classList.remove('hidden');
            controls.unlock();
        });

        // ---------- Leaderboard (hold TAB) ----------
        function renderLeaderboard() {
            const rows = [
                { name: 'PHANTOM-1 (YOU)', team: 'PHANTOMS', kills: killCount, deaths: deathCount, score: playerScore, me: true },
                ...bots.map(b => ({ name: b.name, team: 'GHOSTS', kills: b.kills, deaths: b.deaths, score: b.score, me: false }))
            ].sort((x, y) => y.score - x.score || y.kills - x.kills || x.deaths - y.deaths);

            document.getElementById('lb-team-phantoms').innerText = teamScorePhantoms;
            document.getElementById('lb-team-ghosts').innerText = teamScoreGhosts;

            document.getElementById('lb-body').innerHTML = rows.map((r, i) => {
                const kd = r.deaths === 0 ? r.kills.toFixed(2) : (r.kills / r.deaths).toFixed(2);
                const teamColor = r.team === 'PHANTOMS' ? 'text-sky-400' : 'text-orange-400';
                const rowBg = r.me ? 'bg-sky-500/15' : '';
                return `<tr class="${rowBg} border-b border-slate-800/70">
                    <td class="py-1.5 text-slate-400">${i + 1}</td>
                    <td class="py-1.5 font-bold ${r.me ? 'text-white' : 'text-slate-200'}">${r.name}</td>
                    <td class="py-1.5 ${teamColor} text-xs font-bold tracking-wider">${r.team}</td>
                    <td class="py-1.5 text-right">${r.kills}</td>
                    <td class="py-1.5 text-right">${r.deaths}</td>
                    <td class="py-1.5 text-right text-slate-300">${kd}</td>
                    <td class="py-1.5 text-right font-bold text-amber-400">${r.score}</td>
                </tr>`;
            }).join('');
        }

        let leaderboardTimer = null;
        function showLeaderboard() {
            if (leaderboardTimer) return;
            renderLeaderboard();
            document.getElementById('leaderboard').classList.remove('hidden');
            leaderboardTimer = setInterval(renderLeaderboard, 250);
        }
        function hideLeaderboard() {
            if (leaderboardTimer) { clearInterval(leaderboardTimer); leaderboardTimer = null; }
            document.getElementById('leaderboard').classList.add('hidden');
        }
        window.addEventListener('blur', hideLeaderboard);

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Tab') {
                e.preventDefault();
                showLeaderboard();
                return;
            }
            if (isDead) {
                if (e.code === 'Space' || e.code === 'Enter') {
                    const btn = document.getElementById('respawn-deploy-btn');
                    if (btn && !btn.disabled) {
                        triggerRespawn();
                    }
                }
                return;
            }

            if (e.code === 'KeyN') {
                controls.unlock();
                return;
            }
            if (e.code === 'KeyM') {
                document.getElementById('customizer-panel').classList.toggle('hidden');
                controls.unlock();
                return;
            }
            if (e.code === 'KeyO') {
                toggleSettingsModal();
                return;
            }
            if (e.code === 'Escape') {
                const settingsPanel = document.getElementById('settings-panel');
                if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
                    settingsPanel.classList.add('hidden');
                    return;
                }
                const customizer = document.getElementById('customizer-panel');
                if (customizer && !customizer.classList.contains('hidden')) {
                    customizer.classList.add('hidden');
                    return;
                }
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
                    if (playerStance === 'STAND') {
                        isSprinting = true;
                        isADS = false;
                        gunGroup.visible = true;
                        document.getElementById('sniper-scope').style.opacity = '0';
                    }
                    break;
                case 'KeyC':
                case 'ControlLeft':
                    if (!isGrounded) break;
                    playerStance = playerStance === 'CROUCH' ? 'STAND' : 'CROUCH';
                    if (playerStance !== 'STAND') isSprinting = false;
                    document.getElementById('stance-indicator').innerText = playerStance;
                    break;
                case 'KeyZ':
                    if (!isGrounded) break;
                    playerStance = playerStance === 'PRONE' ? 'STAND' : 'PRONE';
                    if (playerStance !== 'STAND') isSprinting = false;
                    document.getElementById('stance-indicator').innerText = playerStance;
                    break;
                case 'Space':
                    if (canJump && isGrounded) {
                        const playerObj = controls.getObject();
                        if (playerStance !== 'STAND') {
                            const curEyeH = playerStance === 'CROUCH' ? 1.0 : 0.4;
                            playerObj.position.y += (1.6 - curEyeH);
                            playerStance = 'STAND';
                            document.getElementById('stance-indicator').innerText = 'STAND';
                        }
                        velocity.y = (isSprinting ? 12.5 : 11.0);
                        canJump = false;
                        isGrounded = false;
                        landingDip = -0.12;
                    }
                    break;
                case 'KeyR':
                    const maxClip = getMaxClip();
                    if (ammoClip < maxClip && ammoReserve > 0 && !isReloading) {
                        startReload();
                    }
                    break;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Tab') {
                e.preventDefault();
                hideLeaderboard();
                return;
            }
            switch (e.code) {
                case 'KeyW': moveState.forward = false; break;
                case 'KeyS': moveState.backward = false; break;
                case 'KeyA': moveState.left = false; break;
                case 'KeyD': moveState.right = false; break;
                case 'ShiftLeft': isSprinting = false; break;
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (!controls.isLocked) return;
            if (e.button === 0) {
                window.isMouseDown = true;
                shoot();
            }
            if (e.button === 2) {
                isADS = true;
                const scopeConfig = ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron;
                if (scopeConfig.useSniperOverlay) {
                    document.getElementById('sniper-scope').style.opacity = '1';
                    gunGroup.visible = false;
                } else {
                    document.getElementById('sniper-scope').style.opacity = '0';
                    gunGroup.visible = true;
                }
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) window.isMouseDown = false;
            if (e.button === 2) {
                isADS = false;
                document.getElementById('sniper-scope').style.opacity = '0';
                gunGroup.visible = true;
            }
        });

        window.addEventListener('blur', () => {
            window.isMouseDown = false;
            moveState.forward = false;
            moveState.backward = false;
            moveState.left = false;
            moveState.right = false;
            isSprinting = false;
        });

        window.addEventListener('contextmenu', e => e.preventDefault());

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        document.getElementById('close-customizer-btn').addEventListener('click', () => {
            document.getElementById('customizer-panel').classList.add('hidden');
        });

        document.getElementById('reset-gun-btn').addEventListener('click', () => {
            rebuildWeaponMesh();
            gunScale.value = 1.0;
            gunPosX.value = 0.2;
            gunPosY.value = -0.22;
            gunPosZ.value = -0.4;
            updateGunTransform();
            document.getElementById('loader-status').innerText = 'Reset to default procedural weapon.';
        });

        function animate() {
            requestAnimationFrame(animate);

            const delta = Math.min(clock.getDelta(), 0.1);

            updateWeaponAnim(delta);
            const reloadPose = weaponAnim ? weaponAnim.pose : 0;

            if (controls.isLocked) {
                if (currentWeaponKey !== 'AWP' && window.isMouseDown) {
                    shoot();
                }

                mouseSwayX = THREE.MathUtils.lerp(mouseSwayX, targetMouseSwayX, delta * 18);
                mouseSwayY = THREE.MathUtils.lerp(mouseSwayY, targetMouseSwayY, delta * 18);
                targetMouseSwayX = THREE.MathUtils.lerp(targetMouseSwayX, 0, delta * 22);
                targetMouseSwayY = THREE.MathUtils.lerp(targetMouseSwayY, 0, delta * 22);

                const horizSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
                if (horizSpeed > 0.5 && isGrounded) {
                    walkTime += delta * (isSprinting ? 15 : 9);
                } else {
                    walkTime = THREE.MathUtils.lerp(walkTime, 0, delta * 5);
                }

                const bobX = Math.sin(walkTime) * (isSprinting ? 0.022 : 0.011) * (isADS ? 0.15 : 1.0);
                const bobY = Math.cos(walkTime * 2) * (isSprinting ? 0.018 : 0.008) * (isADS ? 0.15 : 1.0);
                const sprintCarryAngle = (isSprinting && horizSpeed > 2 && !isADS) ? Math.PI / 7 : 0;
                const sprintCarryX = (isSprinting && horizSpeed > 2 && !isADS) ? 0.05 : 0;

                const baseGunX = (isADS ? 0 : (parseFloat(gunPosX.value) || 0.2)) + sprintCarryX - 0.04 * reloadPose;
                const adsAimY = (customGunMesh && customGunMesh.userData && customGunMesh.userData.adsAimY) || 0.10;
                const baseGunY = (isADS ? -adsAimY : (parseFloat(gunPosY.value) || -0.22)) + landingDip + 0.14 * reloadPose;
                const baseGunZ = (isADS ? -0.25 : (parseFloat(gunPosZ.value) || -0.4)) + recoilGunKickZ;

                gunGroup.position.x = THREE.MathUtils.lerp(gunGroup.position.x, baseGunX + bobX - mouseSwayX, delta * 14);
                gunGroup.position.y = THREE.MathUtils.lerp(gunGroup.position.y, baseGunY + bobY - mouseSwayY + (recoilGunRotX * 0.08), delta * 14);
                gunGroup.position.z = THREE.MathUtils.lerp(gunGroup.position.z, baseGunZ, delta * 16);

                gunGroup.rotation.z = THREE.MathUtils.lerp(gunGroup.rotation.z, -bobX * 1.5 - mouseSwayX * 2.2 + cameraRoll * 0.8 + recoilGunRotZ - 0.55 * reloadPose, delta * 14);
                gunGroup.rotation.y = THREE.MathUtils.lerp(gunGroup.rotation.y, mouseSwayX * 1.5 + Math.sin(walkTime) * 0.03 - sprintCarryAngle * 0.6 + recoilGunRotY, delta * 14);
                gunGroup.rotation.x = THREE.MathUtils.lerp(gunGroup.rotation.x, mouseSwayY * 1.5 + Math.cos(walkTime * 2) * 0.02 + sprintCarryAngle + recoilGunRotX + 0.30 * reloadPose, delta * 16);

                landingDip = THREE.MathUtils.lerp(landingDip, 0, delta * 8);

                const targetRoll = -direction.x * (isSprinting ? 0.04 : 0.02);
                cameraRoll = THREE.MathUtils.lerp(cameraRoll, targetRoll, delta * 8);
                camera.rotation.z = cameraRoll;

                const isSniperOverlay = ATTACHMENTS.scope[currentLoadout.scope]?.useSniperOverlay;
                if (isADS && isSniperOverlay) {
                    gunGroup.visible = false;
                } else {
                    gunGroup.visible = true;
                }

                const adsScopeType = customGunMesh && customGunMesh.userData ? customGunMesh.userData.scopeType : null;
                const opticObj = customGunMesh ? customGunMesh.getObjectByName('optic') : null;
                if (opticObj) {
                    opticObj.visible = !(isADS && (adsScopeType === 'reddot' || adsScopeType === 'acog'));
                }
                const retDot = document.getElementById('reticle-reddot');
                const retAcog = document.getElementById('reticle-acog');
                if (retDot) retDot.style.opacity = (isADS && adsScopeType === 'reddot') ? '1' : '0';
                if (retAcog) retAcog.style.opacity = (isADS && adsScopeType === 'acog') ? '1' : '0';

                const baseFOV = gameSettings.fov || 78;
                let targetFOV = baseFOV;
                const scopeConfig = ATTACHMENTS.scope[currentLoadout.scope] || ATTACHMENTS.scope.iron;
                if (isADS) {
                    targetFOV = baseFOV * (scopeConfig.fovMultiplier || 0.7);
                } else if (isSprinting && horizSpeed > 2) {
                    targetFOV = baseFOV + 12;
                }
                camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, delta * 10);
                camera.updateProjectionMatrix();

                const ch = document.getElementById('crosshair');
                if (ch) ch.style.opacity = isADS ? '0' : '1';
                updateCrosshairVisuals();

                const pitchDelta = recoilVelPitch * delta;
                const yawDelta = recoilVelYaw * delta;
                controls.pitchObject.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, controls.pitchObject.rotation.x + pitchDelta));
                controls.yawObject.rotation.y += yawDelta;

                recoilVelPitch = THREE.MathUtils.lerp(recoilVelPitch, 0, delta * 22);
                recoilVelYaw = THREE.MathUtils.lerp(recoilVelYaw, 0, delta * 22);

                recoilGunKickZ = THREE.MathUtils.lerp(recoilGunKickZ, 0, delta * 12);
                recoilGunRotX = THREE.MathUtils.lerp(recoilGunRotX, 0, delta * 15);
                recoilGunRotY = THREE.MathUtils.lerp(recoilGunRotY, 0, delta * 14);
                recoilGunRotZ = THREE.MathUtils.lerp(recoilGunRotZ, 0, delta * 14);

                crosshairSpread = THREE.MathUtils.lerp(crosshairSpread, 0, delta * 9);
                if (!window.isMouseDown) {
                    continuousShots = Math.max(0, continuousShots - delta * 35);
                }

                let targetEyeHeight = 1.6;
                if (playerStance === 'CROUCH') targetEyeHeight = 1.0;
                if (playerStance === 'PRONE') targetEyeHeight = 0.4;
                if (isGrounded) {
                    controls.getObject().position.y += (targetEyeHeight - controls.getObject().position.y) * 0.15;
                }

                velocity.x -= velocity.x * 10.0 * delta;
                velocity.z -= velocity.z * 10.0 * delta;
                velocity.y -= 9.8 * 3.2 * delta;

                direction.z = Number(moveState.forward) - Number(moveState.backward);
                direction.x = Number(moveState.right) - Number(moveState.left);
                direction.normalize();

                const stockSpeedMod = ATTACHMENTS.stock[currentLoadout.stock]?.speedMod || 1.0;
                const stanceSpeed = isSprinting ? 115.0 : (playerStance === 'CROUCH' ? 28.0 : (playerStance === 'PRONE' ? 14.0 : 62.0));
                const baseSpeed = stanceSpeed * stockSpeedMod;
                if (moveState.forward || moveState.backward) velocity.z -= direction.z * baseSpeed * delta;
                if (moveState.left || moveState.right) velocity.x -= direction.x * baseSpeed * delta;

                const playerObj = controls.getObject();
                playerObj.translateX(-velocity.x * delta);
                playerObj.translateZ(velocity.z * delta);
                playerObj.position.y += velocity.y * delta;

                if (playerObj.position.y < targetEyeHeight) {
                    if (!isGrounded) {
                        landingDip = -0.08;
                        isGrounded = true;
                    }
                    velocity.y = 0;
                    playerObj.position.y = targetEyeHeight;
                    canJump = true;
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
                fovEl.value = gameSettings.fov;
                document.getElementById('val-setting-fov').innerText = `${gameSettings.fov}°`;
                document.getElementById('setting-volume').value = Math.round(gameSettings.volume * 100);
                document.getElementById('val-setting-volume').innerText = `${Math.round(gameSettings.volume * 100)}%`;
                document.getElementById('setting-sens').value = gameSettings.sensitivity;
                document.getElementById('val-setting-sens').innerText = `${gameSettings.sensitivity.toFixed(2)}x`;
            }
            updateLoadoutUI();
            animate();
        };