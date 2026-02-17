// ============ JENGA 3D GAME ============

let scene, camera, renderer, world;
let blocks = [];
let blockMeshes = [];
let blockBodies = [];
let selectedBlock = null;
let highlightedBlock = null;
let score = 0;
let removedCount = 0;
let gameActive = true;
let towerFallen = false;

// Block dimensions
const BLOCK_WIDTH = 2.5;
const BLOCK_HEIGHT = 0.6;
const BLOCK_DEPTH = 0.8;
const LAYERS = 18;
const BLOCKS_PER_LAYER = 3;

// Camera controls
let cameraAngle = 0;
let cameraPitch = 0.6;
let cameraDistance = 20;
let targetCameraAngle = 0;
let targetCameraPitch = 0.6;
let targetCameraDistance = 20;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Colors for blocks
const blockColors = [
  0xdeb887, 0xd2a679, 0xc49a6c, 0xb8895a,
  0xe8c99b, 0xf0d5a8, 0xc4a265, 0xd4b07a,
];

init();
animate();

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 30, 60);

  // Camera
  camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  updateCameraPosition();

  // Renderer
  const canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Physics world
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -20, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 20;
  world.solver.tolerance = 0.0001;

  // Default contact material
  const defaultMaterial = new CANNON.Material('default');
  const defaultContactMaterial = new CANNON.ContactMaterial(
    defaultMaterial,
    defaultMaterial,
    {
      friction: 0.7,
      restitution: 0.05,
    }
  );
  world.addContactMaterial(defaultContactMaterial);
  world.defaultContactMaterial = defaultContactMaterial;

  // Lights
  setupLights();

  // Ground
  createGround();

  // Table
  createTable();

  // Build tower
  buildTower();

  // Events
  setupEvents();
}

function setupLights() {
  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xffeedd, 1.0);
  mainLight.position.set(10, 20, 10);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 50;
  mainLight.shadow.camera.left = -15;
  mainLight.shadow.camera.right = 15;
  mainLight.shadow.camera.top = 15;
  mainLight.shadow.camera.bottom = -15;
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  fillLight.position.set(-10, 10, -10);
  scene.add(fillLight);

  const pointLight = new THREE.PointLight(0xff8844, 0.5, 30);
  pointLight.position.set(0, 15, 5);
  scene.add(pointLight);
}

function createGround() {
  // Visual ground
  const groundGeo = new THREE.PlaneGeometry(50, 50);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a4a,
    roughness: 0.8,
    metalness: 0.2,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.5;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Physics ground
  const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(0, -0.5, 0);
  world.addBody(groundBody);
}

function createTable() {
  // Table top
  const tableGeo = new THREE.BoxGeometry(8, 0.4, 8);
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0x4a3728,
    roughness: 0.6,
    metalness: 0.1,
  });
  const tableMesh = new THREE.Mesh(tableGeo, tableMat);
  tableMesh.position.set(0, -0.1, 0);
  tableMesh.castShadow = true;
  tableMesh.receiveShadow = true;
  scene.add(tableMesh);

  // Table physics
  const tableBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(4, 0.2, 4)),
  });
  tableBody.position.set(0, -0.1, 0);
  world.addBody(tableBody);

  // Table legs
  const legGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
  const legPositions = [
    [-3, -1.8, -3],
    [3, -1.8, -3],
    [-3, -1.8, 3],
    [3, -1.8, 3],
  ];
  legPositions.forEach((pos) => {
    const leg = new THREE.Mesh(legGeo, tableMat);
    leg.position.set(...pos);
    leg.castShadow = true;
    scene.add(leg);
  });
}

function buildTower() {
  // Clear existing
  blockMeshes.forEach((m) => scene.remove(m));
  blockBodies.forEach((b) => world.removeBody(b));
  blocks = [];
  blockMeshes = [];
  blockBodies = [];
  score = 0;
  removedCount = 0;
  gameActive = true;
  towerFallen = false;

  document.getElementById('score').textContent = '0';
  document.getElementById('removed').textContent = '0';
  document.getElementById('status').textContent = 'Click a block to pull it out!';
  document.getElementById('game-over').style.display = 'none';

  const halfExtents = new CANNON.Vec3(
    BLOCK_WIDTH / 2,
    BLOCK_HEIGHT / 2,
    BLOCK_DEPTH / 2
  );

  for (let layer = 0; layer < LAYERS; layer++) {
    const isEven = layer % 2 === 0;
    const y = 0.1 + BLOCK_HEIGHT / 2 + layer * BLOCK_HEIGHT;

    for (let i = 0; i < BLOCKS_PER_LAYER; i++) {
      const offset = (i - 1) * BLOCK_DEPTH * 1.02;

      let x, z;
      if (isEven) {
        x = 0;
        z = offset;
      } else {
        x = offset;
        z = 0;
      }

      // Color
      const colorIndex = (layer * 3 + i) % blockColors.length;
      const color = blockColors[colorIndex];

      // Three.js mesh
      const geo = new THREE.BoxGeometry(
        BLOCK_WIDTH - 0.05,
        BLOCK_HEIGHT - 0.02,
        BLOCK_DEPTH - 0.05
      );
      const mat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.5,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (isEven) {
        mesh.position.set(x, y, z);
      } else {
        mesh.position.set(x, y, z);
        mesh.rotation.y = Math.PI / 2;
      }
      scene.add(mesh);

      // Cannon.js body
      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Box(halfExtents),
        linearDamping: 0.4,
        angularDamping: 0.6,
      });

      body.position.set(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      );

      if (!isEven) {
        body.quaternion.setFromEuler(0, Math.PI / 2, 0);
      }

      // Start sleeping to let tower settle
      body.sleepSpeedLimit = 0.1;
      body.sleepTimeLimit = 1.0;

      world.addBody(body);

      const blockData = {
        mesh,
        body,
        layer,
        index: i,
        removed: false,
        originalColor: color,
        id: blocks.length,
      };

      blocks.push(blockData);
      blockMeshes.push(mesh);
      blockBodies.push(body);

      // Store reference to block data on mesh
      mesh.userData.blockId = blockData.id;
    }
  }
}

function setupEvents() {
  const canvas = document.getElementById('gameCanvas');

  // Mouse click to select/remove block
  canvas.addEventListener('click', onMouseClick);
  canvas.addEventListener('mousemove', onMouseMove);

  // Camera rotation with right mouse
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.button === 1) {
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      targetCameraAngle -= dx * 0.01;
      targetCameraPitch = Math.max(
        0.1,
        Math.min(1.5, targetCameraPitch - dy * 0.01)
      );
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Zoom
  canvas.addEventListener('wheel', (e) => {
    targetCameraDistance = Math.max(
      8,
      Math.min(35, targetCameraDistance + e.deltaY * 0.02)
    );
  });

  // Prevent context menu
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Touch support
  let touchStartX = 0, touchStartY = 0;
  let isTouchDrag = false;
  let touchTimer = null;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isTouchDrag = false;

      // Tap detection
      touchTimer = setTimeout(() => {
        isTouchDrag = true;
      }, 200);
    }
    if (e.touches.length === 2) {
      isTouchDrag = true;
    }
  });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isTouchDrag) {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      targetCameraAngle -= dx * 0.01;
      targetCameraPitch = Math.max(
        0.1,
        Math.min(1.5, targetCameraPitch - dy * 0.01)
      );
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
    if (e.touches.length === 2) {
      // Pinch zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      targetCameraDistance = Math.max(
        8,
        Math.min(35, 20000 / dist)
      );
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (!isTouchDrag && touchTimer) {
      clearTimeout(touchTimer);
      // Treat as click
      const fakeEvent = {
        clientX: touchStartX,
        clientY: touchStartY,
      };
      onMouseClick(fakeEvent);
    }
    isTouchDrag = false;
  });

  // Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Buttons
  document.getElementById('reset-btn').addEventListener('click', buildTower);
  document.getElementById('restart-btn').addEventListener('click', buildTower);
}

function onMouseMove(e) {
  if (!gameActive) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const meshes = blocks
    .filter((b) => !b.removed)
    .map((b) => b.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  // Reset previous highlight
  if (highlightedBlock !== null) {
    const prevBlock = blocks[highlightedBlock];
    if (prevBlock && !prevBlock.removed) {
      prevBlock.mesh.material.emissive.setHex(0x000000);
    }
  }
  highlightedBlock = null;

  if (intersects.length > 0) {
    const blockId = intersects[0].object.userData.blockId;
    const block = blocks[blockId];

    if (block && !block.removed && canRemoveBlock(block)) {
      block.mesh.material.emissive.setHex(0x443300);
      highlightedBlock = blockId;
      document.getElementById('gameCanvas').style.cursor = 'pointer';
    } else {
      document.getElementById('gameCanvas').style.cursor = 'default';
    }
  } else {
    document.getElementById('gameCanvas').style.cursor = 'default';
  }
}

function onMouseClick(e) {
  if (!gameActive) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const meshes = blocks
    .filter((b) => !b.removed)
    .map((b) => b.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    const blockId = intersects[0].object.userData.blockId;
    const block = blocks[blockId];

    if (block && !block.removed && canRemoveBlock(block)) {
      removeBlock(block);
    }
  }
}

function canRemoveBlock(block) {
  // Find the topmost layer with blocks
  let topLayer = -1;
  blocks.forEach((b) => {
    if (!b.removed && b.layer > topLayer) {
      topLayer = b.layer;
    }
  });

  // Don't allow removing from the very top layer
  if (block.layer === topLayer) return false;

  // Check if this layer has at least 2 blocks remaining (including this one)
  const layerBlocks = blocks.filter(
    (b) => !b.removed && b.layer === block.layer
  );
  if (layerBlocks.length <= 1) return false;

  return true;
}

function removeBlock(block) {
  block.removed = true;
  removedCount++;
  score += (block.layer + 1) * 10;

  document.getElementById('score').textContent = score;
  document.getElementById('removed').textContent = removedCount;
  document.getElementById('status').textContent = `Removed block from layer ${block.layer + 1}!`;

  // Animate block flying out
  const direction = new THREE.Vector3();
  direction
    .subVectors(camera.position, block.mesh.position)
    .normalize()
    .negate();

  // Determine pull direction (perpendicular to block orientation)
  let pullDir;
  if (block.layer % 2 === 0) {
    // Block along X, pull along Z
    pullDir = block.mesh.position.z > 0 ? 1 : -1;
    block.body.velocity.set(0, 2, pullDir * 8);
  } else {
    // Block along Z, pull along X
    pullDir = block.mesh.position.x > 0 ? 1 : -1;
    block.body.velocity.set(pullDir * 8, 2, 0);
  }

  block.body.angularVelocity.set(
    (Math.random() - 0.5) * 5,
    (Math.random() - 0.5) * 5,
    (Math.random() - 0.5) * 5
  );

  // Make it lighter so it flies out
  block.body.mass = 0.3;
  block.body.updateMassProperties();

  // Wake up nearby blocks
  blockBodies.forEach((b) => {
    b.wakeUp();
  });

  // Change color
  block.mesh.material.color.setHex(0xff4444);
  block.mesh.material.emissive.setHex(0x330000);

  // Fade out after delay
  setTimeout(() => {
    fadeOutBlock(block);
  }, 2000);

  // Check tower stability after a delay
  setTimeout(() => {
    checkTowerStability();
  }, 1500);
}

function fadeOutBlock(block) {
  block.mesh.material.transparent = true;
  let opacity = 1;
  const fadeInterval = setInterval(() => {
    opacity -= 0.05;
    block.mesh.material.opacity = opacity;
    if (opacity <= 0) {
      clearInterval(fadeInterval);
      scene.remove(block.mesh);
      world.removeBody(block.body);
    }
  }, 50);
}

function checkTowerStability() {
  if (!gameActive) return;

  // Check if any non-removed block has fallen significantly
  const remainingBlocks = blocks.filter((b) => !b.removed);
  let fallenCount = 0;

  remainingBlocks.forEach((block) => {
    if (block.body.position.y < -0.5) {
      fallenCount++;
    }
    // Check if blocks have toppled (high angular velocity or tilted)
    const vel = block.body.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    if (speed > 10) {
      fallenCount++;
    }
  });

  if (fallenCount >= 3) {
    gameOver();
  }
}

function gameOver() {
  if (towerFallen) return;
  towerFallen = true;
  gameActive = false;

  document.getElementById('status').textContent = '💥 Tower collapsed!';
  document.getElementById('final-score').textContent = score;

  setTimeout(() => {
    document.getElementById('game-over').style.display = 'flex';
  }, 1000);
}

function updateCameraPosition() {
  // Smooth camera
  cameraAngle += (targetCameraAngle - cameraAngle) * 0.08;
  cameraPitch += (targetCameraPitch - cameraPitch) * 0.08;
  cameraDistance += (targetCameraDistance - cameraDistance) * 0.08;

  const lookAtY = LAYERS * BLOCK_HEIGHT * 0.4;

  camera.position.x = Math.sin(cameraAngle) * Math.cos(cameraPitch) * cameraDistance;
  camera.position.y = Math.sin(cameraPitch) * cameraDistance + lookAtY;
  camera.position.z = Math.cos(cameraAngle) * Math.cos(cameraPitch) * cameraDistance;

  camera.lookAt(0, lookAtY, 0);
}

function animate() {
  requestAnimationFrame(animate);

  // Step physics
  world.step(1 / 60);

  // Sync Three.js meshes with Cannon.js bodies
  blocks.forEach((block) => {
    if (!block.removed || block.mesh.material.opacity > 0) {
      block.mesh.position.copy(block.body.position);
      block.mesh.quaternion.copy(block.body.quaternion);
    }
  });

  // Continuous stability check
  if (gameActive && removedCount > 0) {
    checkTowerStability();
  }

  // Update camera
  updateCameraPosition();

  renderer.render(scene, camera);
}
