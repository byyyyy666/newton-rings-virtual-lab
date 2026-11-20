(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const readingResolutionMm = 0.001;
  const roundReading = (value) =>
    Math.round(Number(value) / readingResolutionMm) * readingResolutionMm;
  const formatReading = (value) => {
    if (!Number.isFinite(Number(value))) {
      return "—";
    }
    return Number(value).toFixed(3);
  };
  const readLocal = (key) => {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  };
  const writeLocal = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // The page still works when a browser blocks storage for local files.
    }
  };

  document.body.classList.add("js-reveal");

  const scrollProgress = $("#scrollProgress");
  const updateScrollProgress = () => {
    const pageHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = pageHeight > 0 ? (window.scrollY / pageHeight) * 100 : 0;
    scrollProgress.style.width = `${clamp(progress, 0, 100)}%`;
  };
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  updateScrollProgress();

  const sections = $$(".observed-section");
  const navLinks = $$(".main-nav a");
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  sections.forEach((section) => revealObserver.observe(section));

  const navObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) {
        return;
      }
      navLinks.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`);
      });
    },
    { rootMargin: "-20% 0px -62% 0px", threshold: [0.05, 0.15, 0.3] },
  );
  sections.forEach((section) => navObserver.observe(section));

  function prepareCanvas(canvas) {
    const rectangle = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(canvas.clientWidth || rectangle.width || canvas.width));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.clientWidth || canvas.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function wavelengthRgb(wavelength) {
    let red = 0;
    let green = 0;
    let blue = 0;
    if (wavelength >= 380 && wavelength < 440) {
      red = (440 - wavelength) / 60;
      blue = 1;
    } else if (wavelength < 490) {
      green = (wavelength - 440) / 50;
      blue = 1;
    } else if (wavelength < 510) {
      green = 1;
      blue = (510 - wavelength) / 20;
    } else if (wavelength < 580) {
      red = (wavelength - 510) / 70;
      green = 1;
    } else if (wavelength < 645) {
      red = 1;
      green = (645 - wavelength) / 65;
    } else {
      red = 1;
    }
    const intensity = 0.45 + 0.55 * clamp((wavelength - 380) / 320, 0, 1);
    const gamma = 0.8;
    return [
      Math.round(255 * Math.pow(red * intensity, gamma)),
      Math.round(255 * Math.pow(green * intensity, gamma)),
      Math.round(255 * Math.pow(blue * intensity, gamma)),
    ];
  }


  const heroRingCanvas = $("#heroRingCanvas");

  function renderInterference(canvas, options) {
    const { context, width, height } = prepareCanvas(canvas);
    const {
      wavelength,
      refractiveIndex,
      radius,
      centerX = width / 2,
      centerY = height / 2,
      fieldRadiusMm = 3,
      darkMode = true,
    } = options;

    context.clearRect(0, 0, width, height);
    const background = context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.max(width, height) * 0.72,
    );
    background.addColorStop(0, "#101713");
    background.addColorStop(0.72, "#070a08");
    background.addColorStop(1, "#030504");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const maximumPixelRadius = Math.min(width, height) * 0.47;
    const imageSize = Math.min(420, Math.round(Math.min(width, height) * 0.78));
    if (!renderInterference.buffer || renderInterference.buffer.width !== imageSize) {
      renderInterference.buffer = document.createElement("canvas");
      renderInterference.buffer.width = imageSize;
      renderInterference.buffer.height = imageSize;
    }
    const buffer = renderInterference.buffer;
    const bufferContext = buffer.getContext("2d");
    const imageData = bufferContext.createImageData(imageSize, imageSize);
    const [red, green, blue] = wavelengthRgb(wavelength);
    const center = imageSize / 2;
    const wavelengthMm = wavelength * 1e-6;

    for (let y = 0; y < imageSize; y += 1) {
      for (let x = 0; x < imageSize; x += 1) {
        const pixelRadius = Math.hypot(x - center, y - center);
        const offset = (y * imageSize + x) * 4;
        if (pixelRadius > imageSize * 0.49) {
          imageData.data[offset + 3] = 0;
          continue;
        }
        const normalizedRadius = pixelRadius / (imageSize * 0.43);
        const physicalRadius = normalizedRadius * fieldRadiusMm;
        const filmThickness = (physicalRadius * physicalRadius) / (2 * radius);
        const phase = (4 * Math.PI * refractiveIndex * filmThickness) / wavelengthMm + Math.PI;
        const interference = 0.5 + 0.5 * Math.cos(phase);
        const edge = Math.pow(clamp(1 - normalizedRadius, 0, 1), 1.28);
        const luminous = Math.pow(interference, 1.12) * (0.13 + edge * 0.87);
        const vignette = 0.35 + 0.65 * Math.pow(clamp(1 - normalizedRadius, 0, 1), 0.44);
        const blackLevel = darkMode ? 4 : 14;
        imageData.data[offset] = clamp(blackLevel + red * luminous * vignette, 0, 255);
        imageData.data[offset + 1] = clamp(blackLevel + green * luminous * vignette, 0, 255);
        imageData.data[offset + 2] = clamp(blackLevel + blue * luminous * vignette, 0, 255);
        imageData.data[offset + 3] = 255;
      }
    }
    bufferContext.putImageData(imageData, 0, 0);

    const radiusScale = (maximumPixelRadius / (imageSize * 0.43));
    const drawWidth = imageSize * radiusScale;
    context.save();
    context.globalCompositeOperation = "screen";
    context.imageSmoothingEnabled = true;
    context.drawImage(
      buffer,
      centerX - drawWidth / 2,
      centerY - drawWidth / 2,
      drawWidth,
      drawWidth,
    );
    context.restore();

    const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, maximumPixelRadius);
    glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 0.08)`);
    glow.addColorStop(0.65, `rgba(${red}, ${green}, ${blue}, 0.025)`);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }

  function updateHeroRing() {
    renderInterference(heroRingCanvas, {
      wavelength: 589,
      refractiveIndex: 1,
      radius: 600,
      fieldRadiusMm: 2.2,
    });
  }

  const simulationTabs = $$(".simulation-switcher button");
  const adjustableSimulation = $("#adjustableSimulation");
  const contactSimulation = $("#contactSimulation");
  simulationTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.simulation;
      simulationTabs.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      adjustableSimulation.hidden = selected !== "adjustable";
      contactSimulation.hidden = selected !== "contact";
    });
  });

  const turntableFrames = (prefix) =>
    [1, 4, 7, 10].map((index) => `./assets-instruments/${prefix}-${String(index).padStart(2, "0")}.webp`);

  const ringLabelPositions = [
    { lens: { x: 0.2256, y: 0.2952 }, glass: { x: 0.7203, y: 0.5653 }, screws: { x: 0.4853, y: 0.4667 }, base: { x: 0.5052, y: 0.6706 } },
    { lens: { x: 0.5942, y: 0.2863 }, glass: { x: 0.3051, y: 0.5666 }, screws: { x: 0.4858, y: 0.4653 }, base: { x: 0.5158, y: 0.6717 } },
    { lens: { x: 0.7744, y: 0.3045 }, glass: { x: 0.2797, y: 0.5461 }, screws: { x: 0.5147, y: 0.4653 }, base: { x: 0.4948, y: 0.6722 } },
    { lens: { x: 0.4058, y: 0.3134 }, glass: { x: 0.6949, y: 0.5448 }, screws: { x: 0.5142, y: 0.4667 }, base: { x: 0.4842, y: 0.6712 } },
  ];

  const microscopeHotspotPositions = [
    { eyepiece: { x: 0.55, y: 0.08 }, objective: { x: 0.43, y: 0.61 }, focus: { x: 0.43, y: 0.35 }, micrometer: { x: 0.26, y: 0.52 } },
    { eyepiece: { x: 0.34, y: 0.09 }, objective: { x: 0.35, y: 0.65 }, focus: { x: 0.34, y: 0.40 }, micrometer: { x: 0.68, y: 0.56 } },
    { eyepiece: { x: 0.46, y: 0.10 }, objective: { x: 0.52, y: 0.66 }, focus: { x: 0.41, y: 0.37 }, micrometer: { x: 0.78, y: 0.52 } },
    { eyepiece: { x: 0.58, y: 0.08 }, objective: { x: 0.53, y: 0.64 }, focus: { x: 0.37, y: 0.40 }, micrometer: { x: 0.19, y: 0.58 } },
  ];

  const instrumentDefinitions = {
    microscope: {
      index: "01",
      english: "READING MICROSCOPE",
      name: "读数显微镜",
      alt: "读数显微镜三维模型",
      description:
        "由目镜、物镜、调焦机构和测微鼓轮组成。它把微小的干涉环放大，并将水平位移转换为可估读的毫米刻度。",
      facts: [
        ["主尺分度值", "1 mm"],
        ["鼓轮分度值", "0.01 mm"],
        ["读数方式", "主尺 + 鼓轮"],
      ],
      frames: turntableFrames("microscope"),
      defaultFrame: 0,
    },
    "newton-ring": {
      index: "02",
      english: "NEWTON RING APPARATUS",
      name: "牛顿环仪",
      alt: "牛顿环仪三维模型",
      description:
        "平凸透镜的凸面与平板玻璃接触，形成中心极薄、向外连续增厚的介质薄膜。旋紧螺钉可固定光学元件，但不应使光学面产生明显形变。",
      facts: [
        ["光学结构", "平凸透镜 + 平板玻璃"],
        ["中心薄膜厚度", "趋近于 0"],
        ["干涉类型", "等厚干涉"],
      ],
      states: {
        assembled: turntableFrames("newton-ring-assembled"),
        exploded: turntableFrames("newton-ring-exploded"),
      },
      defaultFrame: 0,
    },
    "sodium-lamp": {
      index: "03",
      english: "SODIUM LAMP",
      name: "钠光灯",
      alt: "钠光灯三维模型",
      description:
        "钠光灯输出稳定的黄色单色光，常见谱线约为 589.0 nm 与 589.6 nm。实验中通常取 589.3 nm，以减小复色光色散对条纹清晰度的影响。",
      facts: [
        ["常用波长", "589.3 nm"],
        ["光谱特征", "近单色黄光"],
        ["使用要求", "充分预热"],
      ],
      frames: turntableFrames("sodium-lamp"),
      defaultFrame: 0,
    },
  };
  const warmedInstrumentFrames = new Map();

  function warmInstrumentFrames(frames) {
    frames.forEach((source) => {
      if (warmedInstrumentFrames.has(source)) {
        return;
      }
      const image = new Image();
      image.decoding = "async";
      warmedInstrumentFrames.set(source, image);
      image.onerror = () => {
        warmedInstrumentFrames.delete(source);
      };
      image.onload = () => {
        image.decode?.().catch(() => {});
      };
      image.src = source;
    });
  }

  function framesForInstrument(instrument) {
    const definition = instrumentDefinitions[instrument];
    return definition.states
      ? Object.values(definition.states).flat()
      : definition.frames;
  }

  function warmAllInstrumentFrames() {
    const frames = Object.keys(instrumentDefinitions).flatMap(framesForInstrument);
    const warm = () => warmInstrumentFrames(frames);
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(warm, { timeout: 1200 });
    } else {
      window.setTimeout(warm, 160);
    }
  }

  const partDefinitions = {
    eyepiece: {
      index: "01",
      title: "目镜",
      text: "观察干涉图样。调清目镜内的十字叉丝，可减少叉丝与条纹之间的视差。",
    },
    objective: {
      index: "02",
      title: "物镜",
      text: "将牛顿环图样放大后送入目镜。调焦时应缓慢接近清晰位置，避免物镜压到被测件。",
    },
    focus: {
      index: "03",
      title: "调焦手轮",
      text: "带动镜筒做小幅上下移动，使干涉环边缘和十字叉丝同时清晰。",
    },
    micrometer: {
      index: "04",
      title: "测微鼓轮",
      text: "与精密螺杆联动，推动测量台横向移动。主尺读数与鼓轮读数相加得到位移量。",
    },
  };

  const instrumentTabs = $$(".instrument-tab");
  const instrumentViewer = $("#instrumentViewer");
  const instrumentImage = $("#instrumentImage");
  const hotspotLayer = $("#hotspotLayer");
  const partExplorer = $("#partExplorer");
  const genericInstrumentNote = $("#genericInstrumentNote");
  const ringStateSwitch = $("#ringStateSwitch");
  const ringStateButtons = $$("#ringStateSwitch button");
  const ringLabelLayer = $("#ringLabelLayer");
  const ringLabels = $$(".component-label", ringLabelLayer);
  const viewerFrameText = $("#viewerFrameText");
  const viewerHint = $(".viewer-hint");
  const hotspots = $$(".hotspot");
  const partButtons = $$(".part-button");
  let activeInstrument = "microscope";
  let activePart = null;
  let activeRingState = "assembled";
  const frameState = {
    microscope: 0,
    "newton-ring-assembled": 0,
    "newton-ring-exploded": 0,
    "sodium-lamp": 0,
  };
  let dragState = null;

  function currentFrameKey() {
    return activeInstrument === "newton-ring" ? `newton-ring-${activeRingState}` : activeInstrument;
  }

  function currentFrames() {
    const definition = instrumentDefinitions[activeInstrument];
    return definition.states ? definition.states[activeRingState] : definition.frames;
  }

  function updateRingLabels(frame) {
    const showLabels = activeInstrument === "newton-ring" && activeRingState === "exploded";
    ringLabelLayer.hidden = !showLabels;
    if (!showLabels) {
      return;
    }
    const positions = ringLabelPositions[frame];
    ringLabels.forEach((label) => {
      const position = positions[label.dataset.label];
      label.style.setProperty("--label-x", `${position.x * 100}%`);
      label.style.setProperty("--label-y", `${position.y * 100}%`);
    });
  }

  function updateMicroscopeHotspots(frame) {
    const showHotspots = activeInstrument === "microscope";
    hotspotLayer.hidden = !showHotspots;
    if (!showHotspots) {
      return;
    }
    const positions = microscopeHotspotPositions[frame] || microscopeHotspotPositions[0];
    const occludedParts = new Set();
    hotspots.forEach((hotspot) => {
      const position = positions[hotspot.dataset.part];
      if (!position) {
        return;
      }
      hotspot.style.setProperty("--x", `${position.x * 100}%`);
      hotspot.style.setProperty("--y", `${position.y * 100}%`);
      hotspot.classList.toggle(
        "is-occluded",
        occludedParts.has(hotspot.dataset.part),
      );
    });
  }

  function updateInstrumentImage(animate = true) {
    const definition = instrumentDefinitions[activeInstrument];
    const frameKey = currentFrameKey();
    const frames = currentFrames();
    const frame = frameState[frameKey];
    const applyFrame = () => {
      instrumentImage.src = frames[frame];
      instrumentImage.alt = definition.alt;
    };
    if (!animate) {
      applyFrame();
      instrumentImage.style.opacity = "1";
    } else {
      instrumentImage.style.opacity = "0.55";
      requestAnimationFrame(() => {
        applyFrame();
        requestAnimationFrame(() => {
          instrumentImage.style.opacity = "1";
        });
      });
    }
    viewerFrameText.textContent = `视角 ${String(frame + 1).padStart(2, "0")} / ${String(frames.length).padStart(2, "0")}`;
    updateRingLabels(frame);
    updateMicroscopeHotspots(frame);
  }

  function activatePart(part, allowToggle = true) {
    if (activeInstrument !== "microscope") {
      return;
    }
    if (!part || (allowToggle && activePart === part)) {
      activePart = null;
    } else {
      activePart = part;
    }
    hotspots.forEach((hotspot) => hotspot.classList.toggle("is-active", hotspot.dataset.part === activePart));
    partButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.part === activePart));
    viewerHint.textContent = activePart ? "部件已点亮" : "拖动旋转";
    if (!activePart) {
      $("#partDetailIndex").textContent = "00";
      $("#partDetailTitle").textContent = "选择部件";
      $("#partDetailText").textContent =
        "点击上方部件或模型中的亮点，查看各部件在调焦、观察与读数中的作用。";
      return;
    }
    const detail = partDefinitions[activePart];
    $("#partDetailIndex").textContent = detail.index;
    $("#partDetailTitle").textContent = detail.title;
    $("#partDetailText").textContent = detail.text;
  }

  function setInstrument(instrument) {
    activeInstrument = instrument;
    const definition = instrumentDefinitions[instrument];
    if (instrument !== "microscope") {
      activePart = null;
    }
    instrumentTabs.forEach((tab) => {
      const active = tab.dataset.instrument === instrument;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    instrumentViewer.dataset.instrument = instrument;
    instrumentViewer.classList.toggle("is-sodium", instrument === "sodium-lamp");
    instrumentViewer.classList.toggle("is-ring", instrument === "newton-ring");
    hotspotLayer.hidden = instrument !== "microscope";
    partExplorer.hidden = instrument !== "microscope";
    ringStateSwitch.hidden = instrument !== "newton-ring";
    ringLabelLayer.hidden = true;
    viewerHint.textContent = "拖动旋转";
    genericInstrumentNote.hidden = instrument === "microscope";
    $("#instrumentIndex").textContent = definition.index;
    $("#instrumentEnglish").textContent = definition.english;
    $("#instrumentName").textContent = definition.name;
    $("#instrumentDescription").textContent = definition.description;
    $("#instrumentFacts").innerHTML = definition.facts
      .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
      .join("");
    warmInstrumentFrames(currentFrames());
    updateInstrumentImage(false);
    if (instrument === "microscope") {
      activatePart(activePart, false);
    } else if (instrument === "newton-ring") {
      genericInstrumentNote.textContent =
        "拖动模型可旋转一周，切换“组合态”和“拆解态”查看空气薄膜两侧的光学元件与紧固结构。";
    } else {
      genericInstrumentNote.textContent =
        "拖动模型可旋转一周，从不同方位观察钠光灯外壳、灯管与出光方向。";
    }
  }

  instrumentTabs.forEach((tab) => {
    const warmTabFrames = () => warmInstrumentFrames(framesForInstrument(tab.dataset.instrument));
    tab.addEventListener("pointerenter", warmTabFrames);
    tab.addEventListener("focus", warmTabFrames);
    tab.addEventListener("click", () => setInstrument(tab.dataset.instrument));
  });

  ringStateButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeRingState = button.dataset.ringState;
      ringStateButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      updateInstrumentImage(false);
    });
  });

  hotspots.forEach((hotspot) => {
    hotspot.addEventListener("pointerdown", (event) => event.stopPropagation());
    hotspot.addEventListener("click", (event) => {
      event.stopPropagation();
      activatePart(hotspot.dataset.part);
    });
  });

  partButtons.forEach((button) => {
    button.addEventListener("click", () => activatePart(button.dataset.part));
  });

  function rotateInstrument(step) {
    const frameKey = currentFrameKey();
    const count = currentFrames().length;
    frameState[frameKey] = (frameState[frameKey] + step + count) % count;
    warmInstrumentFrames(currentFrames());
    updateInstrumentImage(false);
  }

  $("#viewerPrev").addEventListener("click", () => rotateInstrument(-1));
  $("#viewerNext").addEventListener("click", () => rotateInstrument(1));
  $("#viewerReset").addEventListener("click", () => {
    frameState[currentFrameKey()] = instrumentDefinitions[activeInstrument].defaultFrame;
    updateInstrumentImage(false);
  });

  instrumentViewer.addEventListener("pointerdown", (event) => {
    if (
      event.target.closest(".hotspot, .viewer-tool, .component-label")
    ) {
      return;
    }
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startFrame: frameState[currentFrameKey()],
    };
    instrumentViewer.classList.add("is-dragging");
    instrumentViewer.setPointerCapture?.(event.pointerId);
  });

  instrumentViewer.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const frameKey = currentFrameKey();
    const frameCount = currentFrames().length;
    const deltaFrames = Math.round((event.clientX - dragState.startX) / 12);
    const nextFrame = ((dragState.startFrame + deltaFrames) % frameCount + frameCount) % frameCount;
    if (nextFrame !== frameState[frameKey]) {
      frameState[frameKey] = nextFrame;
      updateInstrumentImage(false);
    }
  });

  const endInstrumentDrag = (event) => {
    if (!dragState || (event && event.pointerId !== dragState.pointerId)) {
      return;
    }
    dragState = null;
    instrumentViewer.classList.remove("is-dragging");
  };
  instrumentViewer.addEventListener("pointerup", endInstrumentDrag);
  instrumentViewer.addEventListener("pointercancel", endInstrumentDrag);
  instrumentViewer.addEventListener("pointerleave", (event) => {
    if (event.buttons === 0) {
      endInstrumentDrag(event);
    }
  });
  instrumentViewer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      rotateInstrument(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      rotateInstrument(1);
    }
  });

  const measurementCanvas = $("#measurementCanvas");
  const wheelSlider = $("#wheelSlider");
  const wheelAngleOutput = $("#wheelAngleOutput");
  const operationDeviceStage = $("#operationDeviceStage");
  const operationDeviceCanvas = $("#operationDeviceCanvas");
  const operationDeviceLoader = $("#operationDeviceLoader");
  const operationDeviceStatus = $("#operationDeviceStatus");
  const operationDeviceDrum = $("#operationDeviceDrum");
  const operationDeviceRotate = $("#operationDeviceRotate");
  const operationDeviceReset = $("#operationDeviceReset");
  const microscopeReading = $("#microscopeReading");
  const scanStatus = $("#scanStatus");
  const detailMainPointer = $("#detailMainPointer");
  const detailDrumStage = $("#detailDrumStage");
  const detailDrumImage = $("#detailDrumImage");
  const detailDrumScale = $("#detailDrumScale");
  const detailDrumValue = $("#detailDrumValue");
  const detailDrumInstruction = $("#detailDrumInstruction");
  const practiceReadingInput = $("#practiceReadingInput");
  const checkReading = $("#checkReading");
  const readingCheckResult = $("#readingCheckResult");
  const mainScaleMinMillimeters = 0;
  const mainScaleMaxMillimeters = 50;
  const defaultReadingMillimeters = 22;
  const degreesPerMillimeter = 360;
  const mainScalePointerStartPercent = 13.4146;
  const mainScalePointerEndPercent = 86.5854;
  let currentReadingMillimeters = defaultReadingMillimeters;
  let wheelAngle = 0;
  let detailDrumDrag = null;
  let checkedReadingAngle = null;
  let operationModelViewer = null;
  let operationModelLoadStarted = false;
  let operationManualReading = null;
  let operationAutoRotateRequested = false;

  function buildDrumDial() {
    const namespace = "http://www.w3.org/2000/svg";
    const center = 120;
    const fragment = document.createDocumentFragment();

    const rim = document.createElementNS(namespace, "circle");
    rim.setAttribute("cx", String(center));
    rim.setAttribute("cy", String(center));
    rim.setAttribute("r", "103");
    rim.setAttribute("fill", "none");
    rim.setAttribute("stroke", "rgba(242, 189, 69, 0.38)");
    rim.setAttribute("stroke-width", "1");
    fragment.append(rim);

    for (let division = 0; division < 100; division += 1) {
      const radians = (division * 3.6 * Math.PI) / 180;
      const isMajor = division % 10 === 0;
      const outerRadius = 99;
      const innerRadius = isMajor ? 88 : 94;
      const line = document.createElementNS(namespace, "line");
      line.setAttribute("class", `dial-tick${isMajor ? " is-major" : ""}`);
      line.setAttribute("x1", String(center + Math.sin(radians) * outerRadius));
      line.setAttribute("y1", String(center - Math.cos(radians) * outerRadius));
      line.setAttribute("x2", String(center + Math.sin(radians) * innerRadius));
      line.setAttribute("y2", String(center - Math.cos(radians) * innerRadius));
      fragment.append(line);

      if (isMajor) {
        const label = document.createElementNS(namespace, "text");
        label.setAttribute("class", "dial-number");
        label.setAttribute("x", String(center + Math.sin(radians) * 78));
        label.setAttribute("y", String(center - Math.cos(radians) * 78));
        label.textContent = String(division).padStart(2, "0");
        fragment.append(label);
      }
    }

    detailDrumScale.append(fragment);
  }

  function getMicrometerState() {
    const totalMillimeters = clamp(
      roundReading(currentReadingMillimeters),
      mainScaleMinMillimeters,
      mainScaleMaxMillimeters,
    );
    const mainScale = Math.min(
      mainScaleMaxMillimeters,
      Math.floor(totalMillimeters + 1e-9),
    );
    const exactDrumTicks = (totalMillimeters - mainScale) * 100;
    const drumValue = clamp(Math.floor(exactDrumTicks + 1e-9), 0, 99);
    const drumTenths = clamp(
      Math.round((exactDrumTicks - drumValue) * 10),
      0,
      9,
    );
    return {
      mainScale,
      drumValue,
      drumTenths,
      drumDisplay: `${String(drumValue).padStart(3, "0")}.${drumTenths}`,
      totalMillimeters,
    };
  }

  function showOperationDeviceFallback(message) {
    if (!operationDeviceStage) {
      return;
    }
    operationDeviceStage.classList.remove("has-model");
    operationDeviceStage.classList.add("is-static");
    [operationDeviceDrum, operationDeviceRotate, operationDeviceReset].forEach((button) => {
      if (button) {
        button.disabled = true;
      }
    });
    if (operationDeviceStatus) {
      operationDeviceStatus.textContent = message;
    }
  }

  function syncOperationDeviceReadout(totalMillimeters) {
    operationDeviceStage?.setAttribute(
      "data-reading-mm",
      formatReading(totalMillimeters),
    );
    operationModelViewer?.setReadout?.({
      angleDeg: (totalMillimeters - defaultReadingMillimeters) * degreesPerMillimeter,
      positionMm: totalMillimeters,
    });
  }

  function handleOperationDeviceManualMove({ phase, deltaMm }) {
    if (phase === "start") {
      operationManualReading = currentReadingMillimeters;
      return;
    }
    if (phase === "end") {
      operationManualReading = null;
      return;
    }
    if (phase !== "move" || !Number.isFinite(deltaMm)) {
      return;
    }
    const baseReading = operationManualReading ?? currentReadingMillimeters;
    operationManualReading = clamp(
      roundReading(baseReading + deltaMm),
      mainScaleMinMillimeters,
      mainScaleMaxMillimeters,
    );
    currentReadingMillimeters = operationManualReading;
    updateMeasurement();
  }

  async function ensureOperationDeviceViewer() {
    if (operationModelViewer || operationModelLoadStarted || !operationDeviceCanvas) {
      return;
    }
    operationModelLoadStarted = true;

    if (
      window.location.protocol === "file:"
      || new URLSearchParams(window.location.search).get("static") === "1"
    ) {
      showOperationDeviceFallback("静态装置预览 · 使用启动器可旋转");
      return;
    }

    try {
      const module = await import("./operation-model-viewer.js?v=meshopt-cdn-v8");
      operationModelViewer = await module.initDeviceViewer({
        canvas: operationDeviceCanvas,
        autoRotateDefault: false,
        onReady() {
          operationDeviceStage.classList.add("has-model");
          operationDeviceStage.classList.remove("is-static");
          [operationDeviceDrum, operationDeviceRotate, operationDeviceReset].forEach((button) => {
            if (button) {
              button.disabled = false;
            }
          });
          if (operationDeviceStatus) {
            operationDeviceStatus.textContent = "拖动鼓轮调读数";
          }
        },
        onManualMove: handleOperationDeviceManualMove,
      });
      if (operationAutoRotateRequested) {
        operationAutoRotateRequested = Boolean(operationModelViewer?.toggleAutoRotate?.());
        operationDeviceRotate?.classList.toggle("is-active", operationAutoRotateRequested);
        operationDeviceRotate?.setAttribute("aria-pressed", String(operationAutoRotateRequested));
      }
      const { totalMillimeters } = getMicrometerState();
      syncOperationDeviceReadout(totalMillimeters);
    } catch (error) {
      console.warn("完整装置三维视图载入失败，已切换为静态预览。", error);
      operationDeviceLoader?.remove();
      showOperationDeviceFallback("静态装置预览 · 三维视图不可用");
    }
  }

  function updateMeasurement() {
    wheelAngle = (currentReadingMillimeters - defaultReadingMillimeters) * degreesPerMillimeter;
    const { mainScale, drumDisplay, totalMillimeters } = getMicrometerState();
    wheelAngleOutput.textContent = `${formatReading(totalMillimeters)} mm`;
    wheelSlider.value = totalMillimeters.toFixed(3);
    microscopeReading.textContent = formatReading(totalMillimeters);
    const dialRotation = `rotate(${-wheelAngle}deg)`;
    detailDrumImage.style.transform = dialRotation;
    detailDrumScale.style.transform = dialRotation;
    detailDrumValue.textContent = drumDisplay;
    detailDrumStage.setAttribute("aria-valuenow", totalMillimeters.toFixed(3));
    detailDrumStage.setAttribute(
      "aria-valuetext",
      `${formatReading(totalMillimeters)} 毫米，主尺 ${mainScale} 毫米，鼓轮 ${drumDisplay} 格`,
    );
    syncOperationDeviceReadout(totalMillimeters);
    const scaleProgress = clamp(
      (totalMillimeters - mainScaleMinMillimeters) /
        (mainScaleMaxMillimeters - mainScaleMinMillimeters),
      0,
      1,
    );
    detailMainPointer.style.left = `${
      mainScalePointerStartPercent +
      scaleProgress * (mainScalePointerEndPercent - mainScalePointerStartPercent)
    }%`;
    wheelSlider.setAttribute(
      "aria-valuetext",
      `${formatReading(totalMillimeters)} 毫米，主尺 ${mainScale} 毫米，鼓轮 ${drumDisplay} 格`,
    );

    if (checkedReadingAngle !== null && Math.abs(checkedReadingAngle - wheelAngle) > 0.01) {
      checkedReadingAngle = null;
      readingCheckResult.classList.remove("is-correct", "is-wrong");
      readingCheckResult.textContent = "鼓轮已移动，请重新读取完整读数并保留小数点后三位。";
    }

    const { context, width, height } = prepareCanvas(measurementCanvas);
    const wavelength = 589;
    const radius = 600;
    const refractiveIndex = 1;
    const fieldRadiusMm = 3;
    const maxPixelRadius = Math.min(width, height) * 0.46;
    const pixelToMillimeter = fieldRadiusMm / maxPixelRadius;
    const centerX = width * (0.12 + scaleProgress * 0.76);

    renderInterference(measurementCanvas, {
      wavelength,
      refractiveIndex,
      radius,
      centerX,
      centerY: height / 2,
      fieldRadiusMm,
    });

    context.save();
    context.strokeStyle = "rgba(221, 235, 228, 0.55)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(width / 2, height * 0.09);
    context.lineTo(width / 2, height * 0.91);
    context.moveTo(width * 0.09, height / 2);
    context.lineTo(width * 0.91, height / 2);
    context.stroke();
    context.strokeStyle = "rgba(242, 189, 69, 0.9)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(width / 2, height * 0.41);
    context.lineTo(width / 2, height * 0.45);
    context.moveTo(width / 2, height * 0.55);
    context.lineTo(width / 2, height * 0.59);
    context.moveTo(width * 0.41, height / 2);
    context.lineTo(width * 0.45, height / 2);
    context.moveTo(width * 0.55, height / 2);
    context.lineTo(width * 0.59, height / 2);
    context.stroke();
    context.fillStyle = "rgba(242, 189, 69, 0.8)";
    context.beginPath();
    context.arc(width / 2, height / 2, 1.8, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const distancePixels = Math.abs(width / 2 - centerX);
    const distanceMillimeters = distancePixels * pixelToMillimeter;
    const crossedOrder = Math.max(
      1,
      Math.round((distanceMillimeters * distanceMillimeters * refractiveIndex) / (wavelength * 1e-6 * radius)),
    );
    scanStatus.textContent =
      crossedOrder < 2 ? "位于环心附近" : `靠近第 ${crossedOrder} 级暗环`;
  }

  buildDrumDial();

  wheelSlider.addEventListener("input", () => {
    ensureOperationDeviceViewer();
    currentReadingMillimeters = clamp(
      roundReading(Number(wheelSlider.value)),
      mainScaleMinMillimeters,
      mainScaleMaxMillimeters,
    );
    updateMeasurement();
  });

  function detailDrumPointerAngle(event) {
    const bounds = detailDrumStage.getBoundingClientRect();
    return Math.atan2(
      event.clientY - (bounds.top + bounds.height / 2),
      event.clientX - (bounds.left + bounds.width / 2),
    );
  }

  function shortestAngleDelta(fromAngle, toAngle) {
    let delta = toAngle - fromAngle;
    if (delta > Math.PI) {
      delta -= Math.PI * 2;
    } else if (delta < -Math.PI) {
      delta += Math.PI * 2;
    }
    return delta;
  }

  function finishDetailDrumDrag(event) {
    if (!detailDrumDrag || event.pointerId !== detailDrumDrag.pointerId) {
      return;
    }
    if (detailDrumStage.hasPointerCapture(event.pointerId)) {
      detailDrumStage.releasePointerCapture(event.pointerId);
    }
    detailDrumDrag = null;
    detailDrumStage.classList.remove("is-dragging");
    if (detailDrumInstruction) {
      detailDrumInstruction.textContent = "拖动盘面转动鼓轮，或使用方向键微调。";
    }
  }

  detailDrumStage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    ensureOperationDeviceViewer();
    detailDrumDrag = {
      pointerId: event.pointerId,
      lastAngle: detailDrumPointerAngle(event),
      accumulatedAngle: 0,
      startReading: currentReadingMillimeters,
    };
    detailDrumStage.setPointerCapture(event.pointerId);
    detailDrumStage.classList.add("is-dragging");
    if (detailDrumInstruction) {
      detailDrumInstruction.textContent = "正在转动鼓轮，观察盘面与读数同步变化。";
    }
    event.preventDefault();
  });

  detailDrumStage.addEventListener("pointermove", (event) => {
    if (!detailDrumDrag || event.pointerId !== detailDrumDrag.pointerId) {
      return;
    }
    const nextAngle = detailDrumPointerAngle(event);
    detailDrumDrag.accumulatedAngle += shortestAngleDelta(detailDrumDrag.lastAngle, nextAngle);
    detailDrumDrag.lastAngle = nextAngle;
    const nextReading =
      detailDrumDrag.startReading - detailDrumDrag.accumulatedAngle / (Math.PI * 2);
    currentReadingMillimeters = clamp(
      roundReading(nextReading),
      mainScaleMinMillimeters,
      mainScaleMaxMillimeters,
    );
    updateMeasurement();
    event.preventDefault();
  });

  detailDrumStage.addEventListener("pointerup", finishDetailDrumDrag);
  detailDrumStage.addEventListener("pointercancel", finishDetailDrumDrag);
  detailDrumStage.addEventListener("lostpointercapture", finishDetailDrumDrag);

  detailDrumStage.addEventListener("keydown", (event) => {
    let nextReading = currentReadingMillimeters;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      nextReading += event.shiftKey ? 0.01 : 0.001;
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      nextReading -= event.shiftKey ? 0.01 : 0.001;
    } else if (event.key === "PageUp") {
      nextReading += 0.01;
    } else if (event.key === "PageDown") {
      nextReading -= 0.01;
    } else if (event.key === "Home") {
      nextReading = mainScaleMinMillimeters;
    } else if (event.key === "End") {
      nextReading = mainScaleMaxMillimeters;
    } else {
      return;
    }
    event.preventDefault();
    ensureOperationDeviceViewer();
    currentReadingMillimeters = clamp(
      roundReading(nextReading),
      mainScaleMinMillimeters,
      mainScaleMaxMillimeters,
    );
    updateMeasurement();
  });

  detailDrumStage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      ensureOperationDeviceViewer();
      const direction = event.deltaY > 0 ? -1 : 1;
      const step = event.shiftKey ? 0.01 : 0.001;
      currentReadingMillimeters = clamp(
        roundReading(currentReadingMillimeters + direction * step),
        mainScaleMinMillimeters,
        mainScaleMaxMillimeters,
      );
      updateMeasurement();
    },
    { passive: false },
  );

  operationDeviceDrum?.addEventListener("click", () => {
    ensureOperationDeviceViewer();
    operationModelViewer?.focusDrum?.();
  });

  operationDeviceRotate?.addEventListener("click", () => {
    ensureOperationDeviceViewer();
    if (!operationModelViewer) {
      operationAutoRotateRequested = !operationAutoRotateRequested;
    } else {
      operationAutoRotateRequested = Boolean(operationModelViewer.toggleAutoRotate?.());
    }
    operationDeviceRotate.classList.toggle("is-active", operationAutoRotateRequested);
    operationDeviceRotate.setAttribute("aria-pressed", String(operationAutoRotateRequested));
  });

  operationDeviceReset?.addEventListener("click", () => {
    ensureOperationDeviceViewer();
    operationAutoRotateRequested = false;
    operationDeviceRotate?.classList.remove("is-active");
    operationDeviceRotate?.setAttribute("aria-pressed", "false");
    operationModelViewer?.reset?.();
  });

  if (operationDeviceStage && "IntersectionObserver" in window) {
    const operationDeviceObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          operationDeviceObserver.disconnect();
          ensureOperationDeviceViewer();
        }
      },
      { rootMargin: "0px", threshold: 0.2 },
    );
    operationDeviceObserver.observe(operationDeviceStage);
  } else {
    ensureOperationDeviceViewer();
  }
  window.setTimeout(ensureOperationDeviceViewer, 1500);

  function checkMicrometerReading() {
    const rawInput = practiceReadingInput.value.trim();
    const inputReading = Number(rawInput);
    const { totalMillimeters } = getMicrometerState();
    readingCheckResult.classList.remove("is-correct", "is-wrong");

    if (rawInput === "") {
      readingCheckResult.textContent = "请先输入你读取的完整读数，保留小数点后三位。";
      return;
    }

    if (!Number.isFinite(inputReading) || inputReading < 0 || inputReading > 50) {
      readingCheckResult.textContent = "请输入 0 到 50 之间的完整读数，单位为 mm。";
      return;
    }

    checkedReadingAngle = wheelAngle;
    if (inputReading.toFixed(3) === totalMillimeters.toFixed(3)) {
      readingCheckResult.classList.add("is-correct");
      readingCheckResult.textContent = "读数正确，已按小数点后三位记录。";
      return;
    }

    readingCheckResult.classList.add("is-wrong");
    readingCheckResult.textContent = "读数不正确，请重新读取主尺指标线与鼓轮刻度。";
  }

  checkReading.addEventListener("click", checkMicrometerReading);
  practiceReadingInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      checkMicrometerReading();
    }
  });

  $("#resetOperation").addEventListener("click", () => {
    currentReadingMillimeters = defaultReadingMillimeters;
    updateMeasurement();
  });

  const datasets = {
    traditional: [
      { order: 21, left: 34.021, right: 26.29 },
      { order: 22, left: 34.069, right: 26.192 },
      { order: 23, left: 34.127, right: 26.142 },
      { order: 24, left: 34.213, right: 26.078 },
      { order: 25, left: 34.264, right: 26.001 },
      { order: 46, left: 35.627, right: 24.674 },
      { order: 47, left: 35.702, right: 24.595 },
      { order: 48, left: 35.755, right: 24.555 },
      { order: 49, left: 35.833, right: 24.515 },
      { order: 50, left: 35.899, right: 24.447 },
    ],
    innovation: [
      { order: 21, left: 13.851, right: 6.371 },
      { order: 22, left: 13.912, right: 6.28 },
      { order: 23, left: 13.997, right: 6.21 },
      { order: 24, left: 14.071, right: 6.175 },
      { order: 25, left: 14.159, right: 6.085 },
      { order: 46, left: 15.447, right: 4.735 },
      { order: 47, left: 15.51, right: 4.678 },
      { order: 48, left: 15.566, right: 4.649 },
      { order: 49, left: 15.622, right: 4.565 },
      { order: 50, left: 15.649, right: 4.483 },
    ],
  };

  const dataTableBody = $("#dataTableBody");
  const dataTable = $("#dataTable");
  const dataEmptyState = $("#dataEmptyState");
  const dataWavelength = $("#dataWavelength");
  const nominalRadius = $("#nominalRadius");
  const dataStatus = $("#dataStatus");
  const fitCanvas = $("#fitCanvas");
  const referenceDataButton = $("#referenceDataButton");
  const referenceDataMenu = $("#referenceDataMenu");
  const referenceDataButtons = $$("button[data-dataset]", referenceDataMenu);
  let activeDataset = null;
  let currentFit = null;

  function createDataRow(row = {}) {
    const tableRow = document.createElement("tr");
    tableRow.innerHTML = `
      <td><input type="number" min="1" step="1" data-field="order" value="${row.order ?? ""}" aria-label="环序 k"></td>
      <td><input type="number" step="0.001" data-field="left" value="${row.left ?? ""}" aria-label="左读数"></td>
      <td><input type="number" step="0.001" data-field="right" value="${row.right ?? ""}" aria-label="右读数"></td>
      <td><span class="diameter-cell">—</span></td>
      <td>
        <button class="delete-row" type="button" title="删除此行" aria-label="删除此行">
          <svg><use href="#icon-x"></use></svg>
        </button>
      </td>
    `;
    dataTableBody.appendChild(tableRow);
    updateRowDiameter(tableRow);
    return tableRow;
  }

  function updateRowDiameter(row) {
    const left = Number($("[data-field='left']", row).value);
    const right = Number($("[data-field='right']", row).value);
    const cell = $(".diameter-cell", row);
    if (Number.isFinite(left) && Number.isFinite(right) && left && right) {
      cell.textContent = Math.abs(right - left).toFixed(3);
    } else {
      cell.textContent = "—";
    }
  }

  function renderDataset(rows, datasetKey = null) {
    activeDataset = datasetKey;
    dataTableBody.innerHTML = "";
    rows.forEach((row) => createDataRow(row));
    dataTable.hidden = rows.length === 0;
    dataEmptyState.hidden = rows.length > 0;
    updateDataStatus();
    runFit();
  }

  function collectRows() {
    return $$("tr", dataTableBody).map((row) => {
      const order = Number($("[data-field='order']", row).value);
      const left = Number($("[data-field='left']", row).value);
      const right = Number($("[data-field='right']", row).value);
      return {
        row,
        order,
        left,
        right,
        complete:
          Number.isFinite(order) &&
          Number.isInteger(order) &&
          order > 0 &&
          Number.isFinite(left) &&
          Number.isFinite(right) &&
          left !== 0 &&
          right !== 0,
      };
    });
  }

  function groupedMeasurements() {
    const groups = new Map();
    collectRows()
      .filter((row) => row.complete)
      .forEach((row) => {
        if (!groups.has(row.order)) {
          groups.set(row.order, []);
        }
        groups.get(row.order).push(Math.abs(row.right - row.left));
      });
    return Array.from(groups.entries())
      .map(([order, diameters]) => ({
        order,
        diameter: diameters.reduce((sum, value) => sum + value, 0) / diameters.length,
      }))
      .sort((a, b) => a.order - b.order);
  }

  function updateDataStatus() {
    const count = groupedMeasurements().length;
    dataStatus.textContent = `${count} 个有效环`;
    const hasRows = collectRows().length > 0;
    dataTable.hidden = !hasRows;
    dataEmptyState.hidden = hasRows;
  }

  function linearFit(points) {
    if (points.length < 3) {
      throw new Error("至少需要 3 个有效环才能拟合");
    }
    const x = points.map((point) => point.order);
    const y = points.map((point) => point.diameter * point.diameter);
    const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
    const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
    const sxx = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    if (sxx === 0) {
      throw new Error("环序不足，无法确定斜率");
    }
    const sxy = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0);
    const slope = sxy / sxx;
    const intercept = meanY - slope * meanX;
    const fitted = x.map((value) => slope * value + intercept);
    const residuals = y.map((value, index) => value - fitted[index]);
    const sse = residuals.reduce((sum, value) => sum + value ** 2, 0);
    const meanYDifference = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
    const rSquared = meanYDifference > 0 ? 1 - sse / meanYDifference : 1;
    const residualStd = Math.sqrt(sse / Math.max(1, x.length - 2));
    const slopeUncertainty = residualStd / Math.sqrt(sxx);
    return {
      x,
      y,
      fitted,
      residuals,
      slope,
      intercept,
      rSquared,
      residualStd,
      slopeUncertainty,
      meanX,
      meanY,
    };
  }

  function drawFitChart(fit) {
    const { context, width, height } = prepareCanvas(fitCanvas);
    context.clearRect(0, 0, width, height);
    if (!fit) {
      context.fillStyle = "#8a968f";
      context.font = '12px "Microsoft YaHei"';
      context.textAlign = "center";
      context.fillText(
        dataTableBody.children.length === 0
          ? "选择参考数据或导入测量数据后显示拟合图"
          : "录入至少 3 个有效环后显示拟合图",
        width / 2,
        height / 2,
      );
      return;
    }

    const padding = { top: 24, right: 20, bottom: 40, left: 54 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const minimumX = Math.min(...fit.x);
    const maximumX = Math.max(...fit.x);
    const minimumY = Math.min(...fit.y, ...fit.fitted);
    const maximumY = Math.max(...fit.y, ...fit.fitted);
    const xSpan = Math.max(1, maximumX - minimumX);
    const ySpan = Math.max(0.01, maximumY - minimumY);
    const xToPixel = (value) => padding.left + ((value - minimumX) / xSpan) * chartWidth;
    const yToPixel = (value) => padding.top + (1 - (value - minimumY) / ySpan) * chartHeight;

    context.save();
    context.strokeStyle = "rgba(23, 33, 30, 0.08)";
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const y = padding.top + (chartHeight / 4) * index;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
    }
    context.restore();

    context.save();
    context.strokeStyle = "#3e8f86";
    context.lineWidth = 2;
    context.setLineDash([6, 5]);
    context.beginPath();
    context.moveTo(xToPixel(minimumX), yToPixel(fit.slope * minimumX + fit.intercept));
    context.lineTo(xToPixel(maximumX), yToPixel(fit.slope * maximumX + fit.intercept));
    context.stroke();
    context.restore();

    fit.x.forEach((value, index) => {
      context.save();
      context.fillStyle = "#f2bd45";
      context.strokeStyle = "#b77a0e";
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(xToPixel(value), yToPixel(fit.y[index]), 4.2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
    });

    context.save();
    context.fillStyle = "#6a7771";
    context.font = '10px "Microsoft YaHei"';
    context.textAlign = "center";
    context.fillText("环序 k", padding.left + chartWidth / 2, height - 8);
    context.translate(13, padding.top + chartHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("D² / mm²", 0, 0);
    context.restore();

    context.save();
    context.fillStyle = "#6a7771";
    context.font = '9px "Times New Roman"';
    context.textAlign = "right";
    const yTicks = 4;
    for (let index = 0; index <= yTicks; index += 1) {
      const value = maximumY - (ySpan / yTicks) * index;
      const y = padding.top + (chartHeight / yTicks) * index;
      context.fillText(value.toFixed(2), padding.left - 8, y + 3);
    }
    context.textAlign = "center";
    context.fillText(String(Math.round(minimumX)), xToPixel(minimumX), height - 23);
    context.fillText(String(Math.round(maximumX)), xToPixel(maximumX), height - 23);
    context.restore();
  }

  function runFit() {
    updateDataStatus();
    const measurements = groupedMeasurements();
    const wavelength = Number(dataWavelength.value);
    if (measurements.length < 3 || !Number.isFinite(wavelength) || wavelength <= 0) {
      currentFit = null;
      $("#radiusResult").textContent = "—";
      $("#radiusUncertainty").textContent =
        measurements.length === 0 ? "尚未载入测量数据" : "至少录入 3 个有效环";
      $("#slopeResult").textContent = "—";
      $("#interceptResult").textContent = "—";
      $("#r2Result").textContent = "—";
      $("#residualResult").textContent = "—";
      $("#fitEquationTag").textContent = "D² = bk + c";
      $("#fitNote").innerHTML =
        measurements.length === 0
          ? "<span>+</span><p>点击“参考数据”选择传统组或创新组，也可以导入自己的 JSON 测量数据。</p>"
          : "<span>Δ</span><p>继续录入至少 3 个有效环后生成拟合图和曲率半径结果。</p>";
      drawFitChart(null);
      return;
    }

    try {
      const fit = linearFit(measurements);
      const wavelengthMm = wavelength * 1e-6;
      const radius = fit.slope / (4 * wavelengthMm);
      const uncertainty = fit.slopeUncertainty / (4 * wavelengthMm);
      currentFit = { ...fit, radius, uncertainty, wavelength };
      $("#radiusResult").textContent = Math.abs(radius).toFixed(1);
      $("#radiusUncertainty").textContent =
        `标准不确定度 u(R) = ${uncertainty.toFixed(1)} mm`;
      $("#slopeResult").textContent = `${fit.slope.toFixed(5)} mm²`;
      $("#interceptResult").textContent = `${fit.intercept.toFixed(5)} mm²`;
      $("#r2Result").textContent = fit.rSquared.toFixed(6);
      $("#residualResult").textContent = `${fit.residualStd.toFixed(4)} mm²`;
      $("#fitEquationTag").textContent = `D² = ${fit.slope.toFixed(4)}k ${fit.intercept >= 0 ? "+" : "−"} ${Math.abs(fit.intercept).toFixed(4)}`;
      const nominal = Number(nominalRadius.value);
      const errorText =
        Number.isFinite(nominal) && nominal > 0
          ? `相对误差 ${(((radius - nominal) / nominal) * 100).toFixed(2)}%`
          : "未填写标称曲率半径，不计算相对误差";
      $("#fitNote").innerHTML = `
        <span>Δ</span>
        <p>曲率半径由 <i>R</i> = <i>b</i> / (4λ) 得到；${errorText}。斜率标准不确定度 ${fit.slopeUncertainty.toFixed(5)} mm²。</p>
      `;
      drawFitChart(fit);
    } catch (error) {
      currentFit = null;
      $("#fitNote").innerHTML = `<span>!</span><p>${error.message}</p>`;
      drawFitChart(null);
    }
  }

  dataTableBody.addEventListener("input", (event) => {
    if (!event.target.matches("input")) {
      return;
    }
    updateRowDiameter(event.target.closest("tr"));
    updateDataStatus();
    runFit();
  });

  dataTableBody.addEventListener("click", (event) => {
    const button = event.target.closest(".delete-row");
    if (!button) {
      return;
    }
    button.closest("tr").remove();
    updateDataStatus();
    runFit();
  });

  dataWavelength.addEventListener("input", runFit);
  nominalRadius.addEventListener("input", runFit);

  function closeReferenceMenu() {
    referenceDataMenu.hidden = true;
    referenceDataButton.setAttribute("aria-expanded", "false");
    referenceDataButtons.forEach((button) => button.classList.remove("is-suggested"));
  }

  referenceDataButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = referenceDataMenu.hidden;
    referenceDataMenu.hidden = !willOpen;
    referenceDataButton.setAttribute("aria-expanded", String(willOpen));
  });

  referenceDataButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeDataset = button.dataset.dataset;
      renderDataset(datasets[activeDataset], activeDataset);
      closeReferenceMenu();
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".reference-data")) {
      closeReferenceMenu();
    }
  });
  referenceDataButton.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeReferenceMenu();
    }
  });

  const innovationPlatformFrame = $("#innovationPlatformFrame");
  window.addEventListener("message", (event) => {
    if (
      event.source !== innovationPlatformFrame?.contentWindow
      || event.data?.type !== "newton-innovation-height"
    ) {
      return;
    }
    const height = Math.round(Number(event.data.height));
    if (!Number.isFinite(height)) {
      return;
    }
    const mobile = window.matchMedia("(max-width: 680px)").matches;
    const scrollableView = ["process", "analysis", "report"].includes(event.data.view);
    const minimum = mobile ? 620 : scrollableView ? 720 : 680;
    const maximum = mobile ? 760 : scrollableView ? 920 : 860;
    innovationPlatformFrame.style.height = `${clamp(height + 4, minimum, maximum)}px`;
  });

  $("#addDataRow").addEventListener("click", () => {
    activeDataset = "manual";
    const lastOrder = collectRows()
      .map((row) => row.order)
      .filter((order) => Number.isFinite(order) && order > 0)
      .pop();
    createDataRow({ order: Number.isFinite(lastOrder) ? lastOrder + 1 : 1 });
    updateDataStatus();
    closeReferenceMenu();
  });

  $("#clearData").addEventListener("click", () => {
    activeDataset = null;
    renderDataset([]);
    closeReferenceMenu();
  });

  $("#fitButton").addEventListener("click", runFit);

  $("#dataFileInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const records = Array.isArray(data) ? data : data.data ?? data.records;
      if (!Array.isArray(records)) {
        throw new Error("JSON 中没有测量记录数组");
      }
      const rows = records
        .map((record) => {
          if (Array.isArray(record)) {
            return { order: Number(record[0]), left: Number(record[1]), right: Number(record[2]) };
          }
          return {
            order: Number(record.order),
            left: Number(record.left),
            right: Number(record.right),
          };
        })
        .filter(
          (record) =>
            Number.isFinite(record.order) &&
            Number.isFinite(record.left) &&
            Number.isFinite(record.right),
        );
      if (rows.length < 3) {
        throw new Error("导入文件至少需要 3 条包含 order、left、right 的记录");
      }
      renderDataset(rows, "imported");
      closeReferenceMenu();
    } catch (error) {
      $("#fitNote").innerHTML = `<span>!</span><p>导入失败：${error.message}</p>`;
    } finally {
      event.target.value = "";
    }
  });

  $("#exportCsv").addEventListener("click", () => {
    const rows = collectRows().filter((row) => row.complete);
    if (!rows.length) {
      $("#fitNote").innerHTML = `<span>!</span><p>没有可导出的有效读数。</p>`;
      return;
    }
    const csv = [
      "order,left,right,diameter",
      ...rows.map(
        (row) =>
          `${row.order},${row.left},${row.right},${Math.abs(row.right - row.left).toFixed(3)}`,
      ),
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const exportName =
      activeDataset === "traditional"
        ? "传统实验组"
        : activeDataset === "innovation"
          ? "创新实验组"
          : "自定义测量";
    link.download = `牛顿环测量数据_${exportName}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  const quizForm = $("#quizForm");
  const quizQuestions = $$(".quiz-question");
  const quizProgressText = $("#quizProgressText");
  const quizProgressBar = $("#quizProgressBar");
  const quizScore = $("#quizScore");
  const quizExplanations = {
    q1: "牛顿环由空气薄膜厚度相同的位置形成干涉，因此属于等厚干涉。",
    q2: "中心附近薄膜厚度趋近于零，但下表面反射存在半波损失，两束反射光相位相反。",
    q3: "rₖ 与 √R 成正比，曲率半径增大时外环向外移动，同一相邻级次的环距也会变大。",
    q4: "测量多个暗环直径并对 D² 与 k 作最小二乘拟合，可减小单次读数和中心定位误差的影响。",
  };

  function updateQuizProgress() {
    const answered = quizQuestions.filter((question) => $("input:checked", question)).length;
    quizProgressText.textContent = `${answered} / 4`;
    quizProgressBar.style.width = `${(answered / 4) * 100}%`;
  }

  quizQuestions.forEach((question) => {
    $$("input", question).forEach((input) => {
      input.addEventListener("change", () => {
        question.classList.remove("is-correct", "is-wrong", "has-feedback");
        question.querySelector("[data-feedback]").textContent = "";
        quizScore.textContent = "答案已更新，可重新提交";
        updateQuizProgress();
      });
    });
  });

  quizForm.addEventListener("submit", (event) => {
    event.preventDefault();
    let correctCount = 0;
    let unanswered = 0;
    quizQuestions.forEach((question) => {
      const selected = $("input:checked", question);
      const feedback = question.querySelector("[data-feedback]");
      question.classList.remove("is-correct", "is-wrong");
      if (!selected) {
        unanswered += 1;
        question.classList.add("has-feedback");
        feedback.textContent = "请选择一个答案。";
        return;
      }
      const correct = selected.value === question.dataset.answer;
      question.classList.add("has-feedback", correct ? "is-correct" : "is-wrong");
      feedback.textContent = correct
        ? `回答正确。${quizExplanations[question.dataset.question]}`
        : `再想一想。${quizExplanations[question.dataset.question]}`;
      if (correct) {
        correctCount += 1;
      }
    });
    quizScore.textContent =
      unanswered > 0
        ? `还有 ${unanswered} 道题未作答，当前正确 ${correctCount} 道`
        : `本次得分 ${(correctCount / quizQuestions.length) * 100} 分，答对 ${correctCount} / ${quizQuestions.length} 道`;
    updateQuizProgress();
  });

  const reflectionAnswer = $("#reflectionAnswer");
  const answerCount = $("#answerCount");
  const answerPoints = $("#answerPoints");
  const answerPointsButton = $("#showAnswerPoints");
  const savedReflection = readLocal("newton-lab-reflection");
  if (savedReflection) {
    reflectionAnswer.value = savedReflection;
  }

  function updateAnswerCount() {
    const length = reflectionAnswer.value.trim().length;
    answerCount.textContent = `${length} 字`;
    writeLocal("newton-lab-reflection", reflectionAnswer.value);
  }
  reflectionAnswer.addEventListener("input", updateAnswerCount);
  updateAnswerCount();

  answerPointsButton.addEventListener("click", () => {
    answerPoints.hidden = !answerPoints.hidden;
    answerPointsButton.textContent = answerPoints.hidden ? "查看答题要点" : "收起答题要点";
  });

  function redrawCanvases() {
    updateHeroRing();
    updateMeasurement();
    drawFitChart(currentFit);
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(redrawCanvases, 120);
  });

  renderDataset([]);
  setInstrument("microscope");
  warmAllInstrumentFrames();
  updateHeroRing();
  updateMeasurement();
  updateQuizProgress();
  updateScrollProgress();
})();
