import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Global State ---
let N = 8, M = 8, L = 4; // N=円周(Width), M=高さ(Height), L=未使用
let tiles = [];            // 2次元配列 tiles[x][y]
let boxGroup;              
let knightMesh;            
let visitedPath = [];      
let isGameOver = false;
let interactionTargets = []; 

// エフェクト用
let particles = []; 
let shakeIntensity = 0; 

const COLORS = {
    cyan: 0x00f0ff,
    magenta: 0xff00cc,
    white: 0xffffff,
    unvisited: 0x5588aa, 
    bg: 0x1a1a2e,
    gold: 0xffaa00 
};

// --- Materials ---
const MATERIALS = {
    glassBase: new THREE.MeshPhysicalMaterial({
        color: COLORS.unvisited,
        metalness: 0.1, roughness: 0.2, transmission: 0.2,
        thickness: 1.0, clearcoat: 1.0, ior: 1.5,
        emissive: 0x112244, emissiveIntensity: 0.4
    }),
    trail: new THREE.MeshPhysicalMaterial({
        color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 2.0,
        metalness: 0.5, roughness: 0.1, clearcoat: 1.0, transparent: true, opacity: 0.9
    }),
    hint: new THREE.MeshPhysicalMaterial({
        color: COLORS.magenta, emissive: COLORS.magenta, emissiveIntensity: 1.2,
        metalness: 0.5, roughness: 0.1, transparent: true, opacity: 0.85
    }),
    line: new THREE.LineBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.6 }),
    collider: new THREE.MeshBasicMaterial({ visible: false })
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.FogExp2(COLORS.bg, 0.02);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- Helper: Particle Explosion ---
function spawnExplosion(position, color) {
    const particleCount = 100;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];

    for (let i = 0; i < particleCount; i++) {
        positions.push(position.x, position.y, position.z);
        velocities.push(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5
        );
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: color,
        size: 0.2,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    particles.push({
        mesh: points,
        velocities: velocities,
        life: 1.0 
    });
}

function setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7); 
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    scene.add(sun);
    const cyanPoint = new THREE.PointLight(COLORS.cyan, 80);
    cyanPoint.position.set(-10, 10, -10);
    scene.add(cyanPoint);
    const magPoint = new THREE.PointLight(COLORS.magenta, 80);
    magPoint.position.set(10, -10, 10);
    scene.add(magPoint);
}

// --- Cylindrical Geometry Logic ---

function createKnight() {
    if (knightMesh) scene.remove(knightMesh);
    const group = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan });
    const shellMat = new THREE.MeshPhysicalMaterial({
        color: COLORS.cyan, metalness: 0.1, roughness: 0.1, transmission: 0.9, thickness: 1.0, emissive: COLORS.cyan, emissiveIntensity: 0.5
    });
    
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), coreMat);
    core.name = "core";
    
    const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), shellMat);
    shell.name = "shell";

    const innerGroup = new THREE.Group();
    innerGroup.add(core, shell);
    innerGroup.rotation.set(0, Math.PI / 4, 0); 
    
    const animHolder = new THREE.Group();
    animHolder.add(innerGroup);
    innerGroup.position.set(0, 0, 0); 
    
    group.add(animHolder);
    knightMesh = group;
    scene.add(knightMesh);
    knightMesh.visible = false;
}

function updateKnightPositionToTile(tileMesh) {
    if (!knightMesh || !tileMesh) return;
    knightMesh.visible = true;
    
    const targetPos = new THREE.Vector3();
    tileMesh.getWorldPosition(targetPos);
    
    const targetQuat = new THREE.Quaternion();
    tileMesh.getWorldQuaternion(targetQuat);
    
    // タイルの法線方向に少し浮くように配置
    const offset = new THREE.Vector3(0, 0, 0.45); 
    offset.applyQuaternion(targetQuat);
    targetPos.add(offset);
    
    knightMesh.position.copy(targetPos);
    knightMesh.quaternion.copy(targetQuat);
}

function createLevel() {
    if (boxGroup) scene.remove(boxGroup);
    boxGroup = new THREE.Group(); 
    scene.add(boxGroup);
    
    tiles = []; 
    interactionTargets = []; 
    visitedPath = []; 
    isGameOver = false;
    particles = [];

    // --- Cylinder Parameters ---
    const tileSize = 1.0; 
    
    const tileGeom = new THREE.BoxGeometry(0.96, 0.96, 0.05);
    const edgeGeom = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.9, 0.9));
    const colliderGeom = new THREE.PlaneGeometry(0.96, 0.96);

    // 円周の長さ = N * tileSize
    const radius = (N * tileSize) / (2 * Math.PI); 
    
    // 円筒の中心位置調整
    const yStart = -((M - 1) * tileSize) / 2;

    for (let x = 0; x < N; x++) {
        tiles[x] = [];
        const angle = (x / N) * Math.PI * 2;

        for (let y = 0; y < M; y++) {
            const posX = radius * Math.sin(angle);
            const posZ = radius * Math.cos(angle);
            const posY = yStart + y * tileSize;

            const mesh = new THREE.Mesh(tileGeom, MATERIALS.glassBase.clone());
            mesh.position.set(posX, posY, posZ);
            
            // 円の中心から外側を向くように回転
            mesh.lookAt(posX * 2, posY, posZ * 2);

            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const frame = new THREE.LineSegments(edgeGeom, MATERIALS.line.clone());
            frame.position.z = 0.03;
            mesh.add(frame);

            tiles[x][y] = { mesh, frame };
            boxGroup.add(mesh);

            const collider = new THREE.Mesh(colliderGeom, MATERIALS.collider);
            collider.position.copy(mesh.position);
            collider.quaternion.copy(mesh.quaternion);
            collider.translateZ(0.06); 
            collider.userData = { x, y }; 
            boxGroup.add(collider);
            interactionTargets.push(collider);
        }
    }

    createKnight();
    
    // カメラ位置調整（横幅基準のロジックは維持）
    const vFov = camera.fov * (Math.PI / 180);
    const distH = ((M * tileSize) * 0.8) / (2 * Math.tan(vFov / 2));
    const distW = ((radius * 2.5)) / (2 * Math.tan(vFov / 2) * camera.aspect);
    
    // ★ 変更: 倍率を 1.0 から 1.2 に変更して、少しだけカメラを引く
    const camDist = Math.max(distH, distW) * 1.2; 

    camera.position.set(camDist, camDist * 0.4, camDist);
    
    controls.minDistance = 2.0;
    controls.maxDistance = camDist * 3.0;
    controls.target.set(0, 0, 0);
    controls.update();

    updateVisuals(); 
}

function updateVisuals() {
    const infoEl = document.getElementById('pos-info');
    const total = N * M; 
    
    // Reset all colors
    for(let x=0; x<N; x++) {
        for(let y=0; y<M; y++) {
            const t = tiles[x][y];
            t.mesh.material = MATERIALS.glassBase;
            t.mesh.scale.set(1, 1, 1);
            t.frame.material.emissiveIntensity = 0.4;
            t.frame.material.color.set(0xaaccff);
        }
    }

    // Draw Path
    visitedPath.forEach((p, i) => {
        const isLast = i === visitedPath.length - 1;
        const t = tiles[p.x][p.y];
        t.mesh.material = MATERIALS.trail;
        t.frame.material.opacity = 1.0;
        if (isLast) t.mesh.scale.set(1.1, 1.1, 1.1);
    });

    if (visitedPath.length > 0) {
        const last = visitedPath[visitedPath.length - 1];
        const targetTile = tiles[last.x][last.y].mesh;
        updateKnightPositionToTile(targetTile);
        
        const nextMoves = getPossibleMoves(last).filter(m => !visitedPath.some(v => v.x === m.x && v.y === m.y));
        
        nextMoves.forEach(m => { 
            if (tiles[m.x]?.[m.y]) {
                const tileObj = tiles[m.x][m.y];
                tileObj.mesh.material = MATERIALS.hint;
                tileObj.frame.material.emissive = new THREE.Color(COLORS.magenta);
                tileObj.frame.material.emissiveIntensity = 0.6;
            }
        });

        if (visitedPath.length === total) {
            infoEl.innerHTML = "<span style='color:#ffaa00'>🎉 CYLINDER TOUR COMPLETE!</span>";
            isGameOver = true;
            spawnExplosion(knightMesh.position, COLORS.gold);
            controls.autoRotate = true; 
            controls.autoRotateSpeed = 10.0;
        } else if (nextMoves.length === 0) {
            infoEl.innerHTML = "<span style='color:#ff0000'>💀 SYSTEM HALT / STUCK</span>";
            isGameOver = true;
            shakeIntensity = 0.5;
            document.getElementById('canvas-container').classList.add('damage-effect');
            setTimeout(() => {
                document.getElementById('canvas-container').classList.remove('damage-effect');
            }, 500);
            
            const core = knightMesh.getObjectByName("core");
            const shell = knightMesh.getObjectByName("shell");
            if(core) core.material.color.set(0xff0000);
            if(shell) {
                shell.material.color.set(0xff0000);
                shell.material.emissive.set(0xff0000);
            }
        } else {
            const progress = Math.round((visitedPath.length / total) * 100);
            infoEl.innerText = `PROGRESS: ${progress}% [${visitedPath.length}/${total}]`;
        }
    } else {
        if (knightMesh) knightMesh.visible = false;
        infoEl.innerText = "WAITING FOR INPUT...";
        controls.autoRotate = false;
    }
}

// --- Cylindrical Move Logic ---
function getPossibleMoves(current) {
    const { x, y } = current;
    // Standard Knight moves (8 directions)
    const deltas = [
        [1, 2], [1, -2], [-1, 2], [-1, -2], 
        [2, 1], [2, -1], [-2, 1], [-2, -1]
    ];
    
    let possible = [];
    
    deltas.forEach(([dx, dy]) => {
        // X Logic: Cylindrical Wrap-around (Modulo arithmetic)
        let nx = (x + dx) % N;
        if (nx < 0) nx += N;
        
        // Y Logic: Standard Boundaries
        let ny = y + dy;

        // Check validity
        if (ny >= 0 && ny < M) {
            possible.push({ x: nx, y: ny });
        }
    });
    
    return possible;
}

function moveTo(targetData) {
    if (isGameOver) return;
    if (visitedPath.some(p => p.x === targetData.x && p.y === targetData.y)) return; 
    
    visitedPath.push({ ...targetData });
    updateVisuals();
}

function undoMove() {
    if (visitedPath.length === 0) return;
    visitedPath.pop();
    isGameOver = false;
    
    if(knightMesh) {
        const core = knightMesh.getObjectByName("core");
        const shell = knightMesh.getObjectByName("shell");
        if(core) core.material.color.set(COLORS.cyan);
        if(shell) {
            shell.material.color.set(COLORS.cyan);
            shell.material.emissive.set(COLORS.cyan);
        }
    }
    controls.autoRotate = false;
    updateVisuals();
}

function init() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    document.getElementById('canvas-container').appendChild(renderer.domElement);
    
    setupLighting();
    createLevel(); // Initial creation

    window.addEventListener('resize', () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    renderer.domElement.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary) return; 

        if (renderer.domElement.width !== window.innerWidth * Math.min(window.devicePixelRatio, 2)) {
             renderer.setSize(window.innerWidth, window.innerHeight);
             camera.aspect = window.innerWidth / window.innerHeight;
             camera.updateProjectionMatrix();
        }

        e.preventDefault();
        const rect = renderer.domElement.getBoundingClientRect();
        
        mouse.x = ( ( e.clientX - rect.left ) / rect.width ) * 2 - 1;
        mouse.y = - ( ( e.clientY - rect.top ) / rect.height ) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObjects(interactionTargets, false);
        if (intersects.length > 0) {
            const target = intersects[0].object;
            const data = target.userData; // {x, y}
            
            if (data && !isGameOver) {
                const last = visitedPath.length > 0 ? visitedPath[visitedPath.length - 1] : null;
                
                // 初手 または Valid Move か判定
                if (visitedPath.length === 0) {
                     moveTo(data);
                } else {
                    const moves = getPossibleMoves(last);
                    const isValid = moves.some(m => m.x === data.x && m.y === data.y);
                    if (isValid) {
                        moveTo(data);
                    }
                }
            }
        }
    });

    // --- UI Helpers ---
    function bindTouchClick(element, handler) {
        if (!element) return;
        element.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            handler(e);
        }, { passive: false });
        element.addEventListener('click', (e) => {
            handler(e);
        });
    }

    const menuBtn = document.getElementById('mobile-menu-btn');
    const closeBtn = document.getElementById('close-menu-btn');
    const panel = document.getElementById('main-panel');
    const mobileUndo = document.getElementById('mobile-undo-btn');
    const pcUndo = document.getElementById('btnUndo');

    bindTouchClick(menuBtn, () => panel.classList.add('active'));
    bindTouchClick(closeBtn, () => panel.classList.remove('active'));
    bindTouchClick(mobileUndo, undoMove);
    bindTouchClick(pcUndo, undoMove);

    const updateSize = () => {
        // N = 円周(Width), M = 高さ(Height)
        N = parseInt(document.getElementById('inN').value);
        M = parseInt(document.getElementById('inM').value);
        
        document.getElementById('valN').innerText = N;
        document.getElementById('valM').innerText = M;
        
        createLevel();
    };
    
    updateSize();
    ['N','M'].forEach(id => document.getElementById(`in${id}`).addEventListener('input', updateSize));
    
    document.getElementById('btnApply').addEventListener('click', () => { 
        if(confirm("REBOOT SYSTEM?")) {
            updateSize();
            const panel = document.getElementById('main-panel');
            if(panel) panel.classList.remove('active');
        }
    });

    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getElapsedTime();
        controls.update();

        if (knightMesh && knightMesh.visible) {
             const floatZ = Math.sin(delta * 2) * 0.03;
             // Cylinder logic: local Z is "outwards"
             knightMesh.children[0].position.z = floatZ; 
             knightMesh.children[0].children[0].rotation.y += 0.02; 
        }
        
        if (boxGroup) {
            boxGroup.rotation.y = Math.sin(delta * 0.05) * 0.02; // Slowly rotate cylinder
        }

        if (shakeIntensity > 0) {
            shakeIntensity -= 0.02; 
            if(shakeIntensity < 0) shakeIntensity = 0;
            const rx = (Math.random() - 0.5) * shakeIntensity;
            const ry = (Math.random() - 0.5) * shakeIntensity;
            const rz = (Math.random() - 0.5) * shakeIntensity;
            camera.position.add(new THREE.Vector3(rx, ry, rz));
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= 0.02;
            if (p.life <= 0) {
                scene.remove(p.mesh);
                particles.splice(i, 1);
                continue;
            }
            const posAttr = p.mesh.geometry.attributes.position;
            for (let j = 0; j < posAttr.count; j++) {
                posAttr.setXYZ(
                    j,
                    posAttr.getX(j) + p.velocities[j * 3],
                    posAttr.getY(j) + p.velocities[j * 3 + 1],
                    posAttr.getZ(j) + p.velocities[j * 3 + 2]
                );
            }
            posAttr.needsUpdate = true;
            p.mesh.material.opacity = p.life;
        }

        renderer.render(scene, camera);
    }
    animate();
}

init();