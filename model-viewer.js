import * as THREE from "three";
import { OrbitControls } from "./libs/OrbitControls.js";
import { GLTFLoader } from "./libs/GLTFLoader.js";

export async function initDeviceViewer({
  canvas,
  onReady,
  onError,
  onManualMove,
  autoRotateDefault = true,
  motionScale = null,
  sceneBackground = 0x111a16,
  sceneFog = 0x111a16,
  groundColor = 0x1a2922,
  gridMajorColor = 0x385247,
  gridMinorColor = 0x243a31
}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sceneBackground);
  scene.fog = new THREE.Fog(sceneFog, 2.8, 6.2);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
  camera.position.set(-1.4, 0.9, 1.65);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.autoRotate = autoRotateDefault;
  controls.autoRotateSpeed = 0.72;
  controls.minDistance = 0.32;
  controls.maxDistance = 4.8;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.target.set(0, 0.2, 0);

  const hemi = new THREE.HemisphereLight(0xe8f2ed, 0x1c2822, 2.1);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff4dd, 3.5);
  keyLight.position.set(2.4, 3.8, 2.8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 8;
  keyLight.shadow.camera.left = -2;
  keyLight.shadow.camera.right = 2;
  keyLight.shadow.camera.top = 2;
  keyLight.shadow.camera.bottom = -2;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x92cbb9, 2.2);
  rimLight.position.set(-2.5, 1.4, -2.2);
  scene.add(rimLight);

  const amberLight = new THREE.PointLight(0xffa73e, 4.2, 2.1, 1.8);
  amberLight.position.set(-0.5, 0.5, 0.45);
  scene.add(amberLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 96),
    new THREE.MeshStandardMaterial({
      color: groundColor,
      roughness: 0.85,
      metalness: 0.05
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.68;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(5.2, 26, gridMajorColor, gridMinorColor);
  grid.position.y = -0.676;
  grid.material.opacity = 0.34;
  grid.material.transparent = true;
  scene.add(grid);

  const loader = new GLTFLoader();
  let device = null;
  let meshCount = 0;
  let triangleCount = 0;
  let modelHeight = 1;
  let modelRadius = 1;
  let lampTarget = new THREE.Vector3(-0.5, 0.45, 0.4);
  let resetTarget = new THREE.Vector3(0, 0.18, 0);
  let resetPosition = new THREE.Vector3(-1.4, 0.9, 1.65);
  let autoRotate = autoRotateDefault;
  let drumPivot = null;
  let movingAssembly = null;
  let directDrumParts = [];
  let directStageParts = [];
  let drumPivotLocal = new THREE.Vector3();
  let drumPivotWorld = new THREE.Vector3();
  let modelWorldScaleX = 1;
  let lastDirectDrumRotation = 0;
  let lastDirectStageX = 0;
  let stageBaselineRaw = null;
  let modelUnitsPerMm = motionScale;
  let stageTravelLimit = 0.09;
  let rigMode = "unbound";
  let latestPositionMm = 0;
  let animationPaused = false;
  let lastAnimationAt = null;
  let lampPulsePhase = 0;
  let detailCamera = null;
  let detailFrame = null;
  let detailTarget = null;
  let detailSize = null;

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  function frameObject(object, direction = new THREE.Vector3(1, 0.72, 1.3), fit = 0.92) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.08);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / fit;
    camera.up.set(0, 1, 0);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction.normalize(), distance);
    camera.near = Math.max(0.005, distance / 120);
    camera.far = Math.max(10, distance * 20);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function isScaleDrumDetailMesh(object) {
    const name = object.name || "";
    return (
      name.startsWith("Scale_Linear")
      || name.startsWith("Scale_Central")
      || name.startsWith("Scale_Pointer")
      || name.startsWith("Micrometer_")
    );
  }

  function isDetailTubeOccluder(object) {
    const name = object.name || "";
    return (
      name === "Optics_MainBarrel"
      || name === "Optics_LowerBarrelRim"
      || name === "Optics_AngledNeck"
      || name.startsWith("Optics_Objective")
      || name.startsWith("Optics_Eyepiece")
      || name.startsWith("Optics_Eyecup")
    );
  }

  function getScaleDrumDetailBox(model) {
    const box = new THREE.Box3();
    model.traverse((object) => {
      if (object.isMesh && isScaleDrumDetailMesh(object)) {
        box.expandByObject(object);
      }
    });
    return box.isEmpty() ? null : box;
  }

  function perspectiveTopDistance(size, aspect) {
    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const verticalDistance = size.z / Math.max(0.001, 2 * halfFovTan * 0.82);
    const horizontalDistance = size.x / Math.max(0.001, 2 * halfFovTan * aspect * 0.86);
    return Math.max(verticalDistance, horizontalDistance, 0.28);
  }

  function normaliseModel(model) {
    const initialBox = new THREE.Box3().setFromObject(model);
    const center = initialBox.getCenter(new THREE.Vector3());
    const size = initialBox.getSize(new THREE.Vector3());
    const height = Math.max(size.y, size.x, size.z);
    const scale = 1.32 / Math.max(height, 0.001);
    model.scale.multiplyScalar(scale);
    model.position.sub(center.multiplyScalar(scale));

    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        material.side = THREE.DoubleSide;
        if (material.name === "lamp_sodium_arc") {
          material.emissive.setHex(0xff8a18);
          material.emissiveIntensity = 4.5;
          material.toneMapped = false;
        }
        if (material.name === "SODA_Filament") {
          material.emissive.setHex(0xff8a18);
          material.emissiveIntensity = 4.8;
          material.toneMapped = false;
        }
        if (
          material.name === "lamp_arc_glass"
          || material.name === "lamp_glass"
          || material.name === "SODA_BulbGlass"
        ) {
          material.transparent = true;
          material.opacity = Math.min(material.opacity || 1, 0.22);
          material.depthWrite = false;
          material.roughness = 0.08;
        }
      });
    });
  }

  function updateLampLight() {
    const lampObject =
      device?.getObjectByName("SODA_Filament")
      || device?.getObjectByName("SodiumLamp_DischargeCore")
      || device?.getObjectByName("SODA_Bulb");
    if (!lampObject) return;
    const box = new THREE.Box3().setFromObject(lampObject);
    if (box.isEmpty()) return;
    lampTarget = box.getCenter(new THREE.Vector3());
    amberLight.position.copy(lampTarget);
    amberLight.intensity = 5.4;
  }

  function topmostObjects(objects, root) {
    const selected = new Set(objects);
    return objects.filter((object) => {
      let parent = object.parent;
      while (parent && parent !== root) {
        if (selected.has(parent)) return false;
        parent = parent.parent;
      }
      return true;
    });
  }

  function attachGroup(root, objects, worldCenter) {
    const group = new THREE.Group();
    group.name = "MechanicalPivot";
    root.add(group);
    if (worldCenter) {
      group.position.copy(root.worldToLocal(worldCenter.clone()));
    }
    root.updateMatrixWorld(true);
    topmostObjects(objects, root).forEach((object) => {
      group.attach(object);
    });
    return group;
  }

  function createMechanicalRig(model) {
    model.updateMatrixWorld(true);
    const drumObject = model.getObjectByName("Micrometer_GraduatedDrum");
    const drumObjects = [];
    const movingObjects = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      if (isDirectDrumPart(object.name)) {
        drumObjects.push(object);
      } else if (isDirectStageScalePart(object.name)) {
        movingObjects.push(object);
      }
    });

    if (!drumObject || !drumObjects.length || !movingObjects.length) return false;

    const centerScrew =
      model.getObjectByName("Micrometer_CentreScrew_head")
      || model.getObjectByName("Micrometer_CentreScrew_washer")
      || drumObject;
    const drumCenter = new THREE.Box3()
      .setFromObject(centerScrew)
      .getCenter(new THREE.Vector3());

    if (!modelUnitsPerMm) {
      const linearPlate = model.getObjectByName("Scale_LinearPlate");
      const firstTick = model.getObjectByName("Scale_LinearTick_000");
      const lastTick = model.getObjectByName("Scale_LinearTick_100");
      if (firstTick && lastTick) {
        const firstX = firstTick.getWorldPosition(new THREE.Vector3()).x;
        const lastX = lastTick.getWorldPosition(new THREE.Vector3()).x;
        const scaleSpan =
          Math.abs(lastX - firstX) / Math.max(Math.abs(model.scale.x), 0.0001);
        modelUnitsPerMm = scaleSpan / 50;
        stageTravelLimit = scaleSpan * 0.52;
      } else if (linearPlate) {
        const plateBox = new THREE.Box3().setFromObject(linearPlate);
        const plateWidth = plateBox.getSize(new THREE.Vector3()).x / Math.max(model.scale.x, 0.0001);
        modelUnitsPerMm = plateWidth / 50;
        stageTravelLimit = modelUnitsPerMm * 26;
      } else {
        modelUnitsPerMm = 0.003;
      }
    }
    stageTravelLimit = Math.max(stageTravelLimit, modelUnitsPerMm * 26);

    const stage = new THREE.Group();
    stage.name = "LiveStageGroup";
    model.add(stage);
    model.updateMatrixWorld(true);
    topmostObjects(movingObjects, model).forEach((object) => stage.attach(object));
    stage.updateMatrixWorld(true);

    const drum = new THREE.Group();
    drum.name = "LiveDrumGroup";
    model.add(drum);
    model.updateMatrixWorld(true);
    drum.position.copy(model.worldToLocal(drumCenter.clone()));
    model.updateMatrixWorld(true);
    drum.updateMatrixWorld(true);
    topmostObjects(drumObjects, model).forEach((object) => drum.attach(object));

    drumPivotWorld.copy(drumCenter);
    drumPivotLocal.copy(model.worldToLocal(drumCenter.clone()));
    drumPivot = drum;
    movingAssembly = stage;
    rigMode = "parts";
    model.updateMatrixWorld(true);
    return true;
  }

  function setupPreRiggedMechanics(model) {
    const nextDrumPivot = model.getObjectByName("Pivot_Drum");
    const nextMovingAssembly = model.getObjectByName("Pivot_Stage");
    if (!nextDrumPivot || !nextMovingAssembly) return false;

    drumPivot = nextDrumPivot;
    movingAssembly = nextMovingAssembly;
    rigMode = "pivot";

    if (!modelUnitsPerMm) {
      const linearPlate = model.getObjectByName("Scale_LinearPlate");
      if (linearPlate) {
        const plateBox = new THREE.Box3().setFromObject(linearPlate);
        const plateWidth = plateBox.getSize(new THREE.Vector3()).x / Math.max(model.scale.x, 0.0001);
        modelUnitsPerMm = plateWidth / 50;
      } else {
        modelUnitsPerMm = 0.003;
      }
    }
    stageTravelLimit = Math.max(stageTravelLimit, modelUnitsPerMm * 26);

    model.updateMatrixWorld(true);
    return true;
  }

  function isDirectDrumPart(name) {
    return (
      name === "Micrometer_GraduatedDrum"
      || name === "Micrometer_KnurledRim"
      || name === "Micrometer_FrontDish"
      || name === "Micrometer_Spindle"
    || name === "Micrometer_CrankPin"
    || name === "Micrometer_CrankGrip"
      || name.startsWith("Micrometer_Division_")
      || name.startsWith("Micrometer_Number_")
    );
  }

  function isDirectStageScalePart(name) {
    return (
      name.startsWith("Optics_")
      || name.startsWith("Mirror_")
      || name.startsWith("Focus_")
      || name.startsWith("Scale_Vertical")
      || name.startsWith("Scale_Vernier")
      || (
        name.startsWith("Connection_")
        && !name.startsWith("Connection_PostSeat")
        && !name.startsWith("Connection_Clamp")
      )
    );
  }

  function bindIndexScaleToRearTube(model) {
    const rearTube =
      model.getObjectByName("Optics_MainBarrel")
      || model.getObjectByName("Optics_EyepieceTube");
    if (!rearTube) return;

    const pointerParts = [];
    model.traverse((object) => {
      if (
        object.name === "Scale_CentralPointer"
        || object.name === "Scale_PointerHairline"
        || object.name.startsWith("Scale_PointerMountScrew_")
      ) {
        pointerParts.push(object);
      }
    });
    pointerParts.forEach((part) => {
      if (part.parent !== rearTube) rearTube.attach(part);
    });
  }

  function setupDirectMechanics(model) {
    const drumObject = model.getObjectByName("Micrometer_GraduatedDrum");
    if (!drumObject) return;
    rigMode = "direct";
    directDrumParts = [];
    directStageParts = [];
    const centerScrew =
      model.getObjectByName("Micrometer_CentreScrew_head")
      || model.getObjectByName("Micrometer_CentreScrew_washer")
      || drumObject;
    const centerScrewBox = new THREE.Box3().setFromObject(centerScrew);
    drumPivotWorld = centerScrewBox.getCenter(new THREE.Vector3());
    drumPivotLocal = model.worldToLocal(drumPivotWorld.clone());
    model.updateMatrixWorld(true);
    modelWorldScaleX = model.getWorldScale(new THREE.Vector3()).x;

    model.traverse((object) => {
      if (!object.isMesh) return;
      const parentInverse = object.parent
        ? object.parent.matrixWorld.clone().invert()
        : new THREE.Matrix4();
      const baseWorldPosition = object.getWorldPosition(new THREE.Vector3());
      const baseWorldQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
      const baseWorldScale = object.getWorldScale(new THREE.Vector3());
      if (isDirectDrumPart(object.name)) {
        directDrumParts.push({
          object,
          parentInverse,
          baseWorldPosition,
          baseWorldQuaternion,
          baseWorldScale
        });
      } else if (isDirectStageScalePart(object.name)) {
        directStageParts.push({
          object,
          parentInverse,
          baseWorldPosition,
          baseWorldQuaternion,
          baseWorldScale
        });
      }
    });

    if (!modelUnitsPerMm) {
      const linearPlate = model.getObjectByName("Scale_LinearPlate");
      if (linearPlate) {
        const plateBox = new THREE.Box3().setFromObject(linearPlate);
        const plateWidth = plateBox.getSize(new THREE.Vector3()).x / Math.max(model.scale.x, 0.0001);
        modelUnitsPerMm = plateWidth / 50;
      } else {
        modelUnitsPerMm = 0.003;
      }
    }
    stageTravelLimit = Math.max(stageTravelLimit, modelUnitsPerMm * 26);
    model.updateMatrixWorld(true);
  }

  function setupScaleDetailView(model) {
    const detailBox = getScaleDrumDetailBox(model);
    if (!detailBox) return;

    detailTarget = detailBox.getCenter(new THREE.Vector3());
    detailSize = detailBox.getSize(new THREE.Vector3());
    detailCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 10);
    detailCamera.layers.set(1);
    detailCamera.up.set(0, 0, 1);
    detailCamera.position.set(detailTarget.x, detailTarget.y + 1, detailTarget.z);
    detailCamera.lookAt(detailTarget);

    [hemi, keyLight, rimLight, amberLight].forEach((light) => {
      light.layers.enable(1);
    });
    model.traverse((object) => {
      if (object.isMesh && !isDetailTubeOccluder(object)) {
        object.layers.enable(1);
      }
    });

    if (canvas.parentElement?.classList.contains("live-device-stage")) {
      detailFrame = document.createElement("div");
      detailFrame.className = "live-detail-frame";
      detailFrame.innerHTML = "<span>主尺 + 鼓轮 · 俯视</span>";
      canvas.parentElement.appendChild(detailFrame);
    }
  }

  function bindManualDrumControl() {
    if (!drumPivot || typeof onManualMove !== "function") return;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let drag = null;

    function isDrumHit(event) {
      const bounds = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(drumPivot, true).length > 0;
    }

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !isDrumHit(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      controls.enabled = false;
      drag = { y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      onManualMove({ phase: "start", positionMm: latestPositionMm });
    }, true);

    canvas.addEventListener("pointermove", (event) => {
      if (!drag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const deltaMm = (drag.y - event.clientY) * 0.01;
      drag.y = event.clientY;
      if (Math.abs(deltaMm) < 1e-6) return;
      onManualMove({ phase: "move", deltaMm, positionMm: latestPositionMm });
    }, true);

    function finishDrag(event) {
      if (!drag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = null;
      controls.enabled = true;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      onManualMove({ phase: "end", positionMm: latestPositionMm });
    }

    canvas.addEventListener("pointerup", finishDrag, true);
    canvas.addEventListener("pointercancel", finishDrag, true);
  }

  function setReadout({ angleDeg, positionMm, raw, countsPerRev, pitchMm, angleOffsetDeg = 0 }) {
    if (!drumPivot && !movingAssembly && !directDrumParts.length && !directStageParts.length) return;
    if (Number.isFinite(positionMm)) latestPositionMm = positionMm;

    const displayAngle = Number.isFinite(raw) && Number.isFinite(countsPerRev) && countsPerRev > 0
      ? raw / countsPerRev * 360 - angleOffsetDeg
      : angleDeg - angleOffsetDeg;

    let displacementMm = null;
    if (
      Number.isFinite(raw)
      && Number.isFinite(countsPerRev)
      && Number.isFinite(pitchMm)
      && countsPerRev > 0
    ) {
      if (stageBaselineRaw == null) stageBaselineRaw = raw;
      displacementMm = (raw - stageBaselineRaw) / countsPerRev * pitchMm;
    } else if (Number.isFinite(positionMm)) {
      if (stageBaselineRaw == null) stageBaselineRaw = positionMm;
      displacementMm = positionMm - stageBaselineRaw;
    }
    const stageX = displacementMm == null
      ? lastDirectStageX
      : THREE.MathUtils.clamp(
        -displacementMm * modelUnitsPerMm,
        -stageTravelLimit,
        stageTravelLimit
      );
    const stageWorldX = stageX * modelWorldScaleX;

    if (drumPivot) {
      drumPivot.rotation.x = THREE.MathUtils.degToRad(-(((displayAngle % 360) + 360) % 360));
    }

    if (directDrumParts.length) {
      const axisWorld = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(device.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        axisWorld,
        THREE.MathUtils.degToRad(-(((displayAngle % 360) + 360) % 360))
      );
      directDrumParts.forEach((part) => {
        const offset = part.baseWorldPosition.clone().sub(drumPivotWorld).applyQuaternion(rotation);
        const targetWorldPosition = drumPivotWorld.clone().add(offset);
        targetWorldPosition.x += stageWorldX;
        const targetWorldQuaternion = rotation.clone().multiply(part.baseWorldQuaternion);
        const worldMatrix = new THREE.Matrix4().compose(
          targetWorldPosition,
          targetWorldQuaternion,
          part.baseWorldScale
        );
        const localMatrix = part.parentInverse.clone().multiply(worldMatrix);
        localMatrix.decompose(part.object.position, part.object.quaternion, part.object.scale);
      });
      lastDirectDrumRotation = THREE.MathUtils.degToRad(-(((displayAngle % 360) + 360) % 360));
    }

    if (displacementMm != null) {
      if (movingAssembly) movingAssembly.position.x = stageX;
      if (directStageParts.length) {
        directStageParts.forEach((part) => {
          const targetWorldPosition = part.baseWorldPosition.clone();
          targetWorldPosition.x += stageWorldX;
          const worldMatrix = new THREE.Matrix4().compose(
            targetWorldPosition,
            part.baseWorldQuaternion,
            part.baseWorldScale
          );
          const localMatrix = part.parentInverse.clone().multiply(worldMatrix);
          localMatrix.decompose(part.object.position, part.object.quaternion, part.object.scale);
        });
      }
      lastDirectStageX = stageX;
    }

    canvas.dataset.rigMode = rigMode;
    canvas.dataset.stageX = String(stageX);
    canvas.dataset.drumRotation = String(
      directDrumParts.length
        ? lastDirectDrumRotation
        : drumPivot
          ? drumPivot.rotation.x
          : 0
    );
    canvas.dataset.stageMm = String(displacementMm ?? 0);
  }

  function focusDrum() {
    if (!detailTarget || !detailSize) return;
    const bounds = canvas.getBoundingClientRect();
    const aspect = Math.max(0.5, bounds.width / Math.max(1, bounds.height));
    const distance = perspectiveTopDistance(detailSize, aspect);
    controls.autoRotate = false;
    autoRotate = false;
    camera.up.set(0, 0, 1);
    controls.target.copy(detailTarget);
    camera.position.set(detailTarget.x, detailTarget.y + distance, detailTarget.z);
    camera.near = Math.max(0.005, distance / 120);
    camera.far = 20;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function setStageOrigin(raw) {
    if (!Number.isFinite(raw)) return;
    stageBaselineRaw = raw;
    if (movingAssembly) movingAssembly.position.x = 0;
    directStageParts.forEach((part) => {
      const worldMatrix = new THREE.Matrix4().compose(
        part.baseWorldPosition,
        part.baseWorldQuaternion,
        part.baseWorldScale
      );
      const localMatrix = part.parentInverse.clone().multiply(worldMatrix);
      localMatrix.decompose(part.object.position, part.object.quaternion, part.object.scale);
    });
    lastDirectStageX = 0;
  }

  function setAnimationPaused(paused) {
    animationPaused = Boolean(paused);
    controls.autoRotate = autoRotate && !animationPaused;
  }

  function resetView() {
    controls.autoRotate = autoRotate && !animationPaused;
    if (!device) return;
    camera.up.set(0, 1, 0);
    controls.target.copy(resetTarget);
    camera.position.copy(resetPosition);
    camera.near = 0.01;
    camera.far = 20;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function focusLamp() {
    controls.autoRotate = false;
    autoRotate = false;
    const lampObject = device?.getObjectByName("SODA_Filament")
      || device?.getObjectByName("SodiumLamp_DischargeCore")
      || device?.getObjectByName("SodiumLamp_ArcTube_Glass")
      || device?.getObjectByName("SODA_Bulb")
      || device?.getObjectByName("lamp_0");
    if (lampObject) {
      frameObject(lampObject, new THREE.Vector3(1, 0.35, 1.15), 1.35);
    } else {
      controls.target.copy(lampTarget);
      camera.position.copy(lampTarget).add(new THREE.Vector3(0.38, 0.2, 0.38));
      controls.update();
    }
  }

  function toggleAutoRotate() {
    autoRotate = !autoRotate;
    controls.autoRotate = autoRotate && !animationPaused;
    return autoRotate;
  }

  const gltf = await loader.loadAsync("./assets-core/device.glb?v=range50-v3");
  device = gltf.scene;
  normaliseModel(device);
  scene.add(device);
  if (!createMechanicalRig(device)) {
    if (!setupPreRiggedMechanics(device)) {
      setupDirectMechanics(device);
    }
  }
  bindIndexScaleToRearTube(device);
  setupScaleDetailView(device);
  bindManualDrumControl();

  device.traverse((child) => {
    if (!child.isMesh) return;
    meshCount += 1;
    const geometry = child.geometry;
    const count = geometry?.index ? geometry.index.count / 3 : geometry?.attributes?.position?.count / 3;
    if (Number.isFinite(count)) triangleCount += count;
  });

  updateLampLight();
  const wholeBox = new THREE.Box3().setFromObject(device);
  const wholeSphere = wholeBox.getBoundingSphere(new THREE.Sphere());
  modelRadius = wholeSphere.radius;
  modelHeight = wholeBox.getSize(new THREE.Vector3()).y;
  resetTarget = wholeBox.getCenter(new THREE.Vector3());
  const cameraDistance = modelRadius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.1;
  resetPosition = resetTarget.clone().add(new THREE.Vector3(-1.15, 0.58, 1.38).normalize().multiplyScalar(cameraDistance));
  resetView();
  resize();

  let frame = 0;
  function animate() {
    frame = requestAnimationFrame(animate);
    controls.update();
    const now = performance.now();
    const deltaMs = lastAnimationAt == null ? 0 : Math.min(100, now - lastAnimationAt);
    lastAnimationAt = now;
    if (!animationPaused) {
      lampPulsePhase += deltaMs * 0.0018;
    }
    const pulse = 4.7 + Math.sin(lampPulsePhase) * 0.55;
    amberLight.intensity = pulse;
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.setScissor(0, 0, size.x, size.y);
    renderer.clear();
    renderer.render(scene, camera);

    if (detailCamera) {
      const insetWidth = Math.min(340, size.x * 0.42);
      const insetHeight = insetWidth * 0.57;
      const insetX = size.x - insetWidth - 16;
      const insetY = 16;
      detailCamera.aspect = insetWidth / insetHeight;
      const halfWidth = Math.max(
        detailSize.x / 2 / 0.88,
        detailSize.z * detailCamera.aspect / 2 / 0.8
      );
      detailCamera.left = -halfWidth;
      detailCamera.right = halfWidth;
      detailCamera.top = halfWidth / detailCamera.aspect;
      detailCamera.bottom = -detailCamera.top;
      detailCamera.updateProjectionMatrix();
      renderer.setViewport(insetX, insetY, insetWidth, insetHeight);
      renderer.setScissor(insetX, insetY, insetWidth, insetHeight);
      renderer.clear();
      renderer.render(scene, detailCamera);
      if (detailFrame) {
        detailFrame.style.width = `${insetWidth}px`;
        detailFrame.style.height = `${insetHeight}px`;
      }
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
  }
  animate();

  window.addEventListener("resize", resize);

  if (typeof onReady === "function") {
    onReady({
      meshes: meshCount,
      triangles: Math.round(triangleCount),
      height: modelHeight,
      radius: modelRadius
    });
  }

  return {
    reset: resetView,
    focusLamp,
    focusDrum,
    setReadout,
    setStageOrigin,
    setAnimationPaused,
    toggleAutoRotate,
    getRigState: () => ({
      mode: rigMode,
      drumRotation: directDrumParts.length ? lastDirectDrumRotation : drumPivot ? drumPivot.rotation.x : null,
      drumParts: directDrumParts.length || (drumPivot ? drumPivot.children.length : 0),
      movingParts: directStageParts.length || (movingAssembly ? movingAssembly.children.length : 0),
      stageX: directStageParts.length ? lastDirectStageX : movingAssembly ? movingAssembly.position.x : null,
      unitsPerMm: modelUnitsPerMm,
      drumCenter: drumPivotLocal.toArray(),
      animationPaused,
      lampPulsePhase
    }),
    scene,
    camera,
    detailCamera,
    controls,
    dispose() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    }
  };
}
