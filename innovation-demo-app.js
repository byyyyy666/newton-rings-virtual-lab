(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const EMBED_MODE = new URLSearchParams(window.location.search).get("embed") === "1";
  const SETTINGS_KEY = "nrfusion.settings.v1";
  const SESSION_KEY = "nrfusion.session.v1";
  const ESP_STORAGE_KEY = "nrfusion.esp.host.v1";
  const TIMEZONE = "Asia/Shanghai";
  const MODEL_SCALE_ZERO_MM = 26;
  const MEASUREMENT_MIN_MM = 0;
  const MEASUREMENT_MAX_MM = 50;
  const DEMO_TRAVEL_MIN_MM = 11.683;
  const DEMO_TRAVEL_MAX_MM = 38.319;
  const DEMO_TRAVEL_DURATION_MS = 22000;
  const RING_MAX_DETECTED = 80;
  const DEFAULT_CALIBRATION_RATIO = 0.48;
  const CALIBRATION_VERSION = 1;
  const DEMO_DATA_VERSION = 11;
  const CANVAS_THEME = Object.freeze({
    surface: "#f7f9fa",
    surfaceMid: "#e3ebef",
    ink: "#1b1b1b",
    inkSoft: "#3e3d3b",
    muted: "#626464",
    line: "#aabac3",
    blue: "#7692a7",
    blueDark: "#455d6b",
    amber: "#d79d54",
    amberSoft: "#f4e4cf"
  });

  const DEFAULT_SETTINGS = {
    wsUrl: "ws://127.0.0.1:8765",
    visionUrl: "http://127.0.0.1:18080/api/analyze",
    drumZeroAngle: 0,
    countsPerRev: 8192,
    pitchMm: 1,
    settingsVersion: 8,
    direction: 1,
    zeroOffsetMm: 0,
    startPositionMm: 25,
    ringBase: 1,
    visionInterval: 0.1,
    cameraRotationDeg: -90,
    cameraCropRatio: 0.3,
    cameraCropOffsetPx: -50,
    serialBaud: 115200
  };

  const DEMO_ORDERS = Array.from({ length: 30 }, (_, index) => 30 - index);
  const EVENT_ICONS = {
    session: "play-circle",
    pause: "pause-circle",
    capture: "map-pin",
    pair: "link-2",
    vision: "scan-eye",
    encoder: "cpu",
    camera: "camera",
    fit: "chart-spline",
    report: "sparkles",
    warning: "triangle-alert",
    archive: "archive",
    reset: "rotate-ccw"
  };

  function loadJson(key, fallback) {
    let value = null;
    try {
      value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      if (typeof fallback === "string" && value) {
        return value;
      }
      console.warn("Unable to load local state:", error);
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("Unable to save local state:", error);
      return false;
    }
  }

  function uid(prefix = "id") {
    if (window.crypto?.randomUUID) {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  function mean(values) {
    return values.length ? sum(values) / values.length : 0;
  }

  function std(values) {
    if (values.length < 2) return 0;
    const avg = mean(values);
    return Math.sqrt(sum(values.map((value) => (value - avg) ** 2)) / (values.length - 1));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function rounded(value, digits = 4) {
    if (!Number.isFinite(value)) return "--";
    return Number(value).toFixed(digits);
  }

  function formatData3(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : "--";
  }

  function signed(value, digits = 4) {
    if (!Number.isFinite(value)) return "--";
    return `${value >= 0 ? "+" : ""}${Number(value).toFixed(digits)}`;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  function formatter(options) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: TIMEZONE,
      ...options
    });
  }

  function formatClock(value = new Date(), withMilliseconds = false) {
    return formatter({
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...(withMilliseconds ? { fractionalSecondDigits: 3 } : {})
    }).format(new Date(value));
  }

  function formatDateTime(value) {
    return formatter({
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(value)).replace(/\//g, "-");
  }

  function formatDate(value) {
    return formatter({
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(value)).replace(/\//g, "-");
  }

  function parseTimestamp(value) {
    if (!value) return Date.now();
    if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function buildDemoSession() {
    const started = new Date(Date.now() - 12 * 60 * 1000 - 47 * 1000);
    const wavelengthNm = 589.3;
    const referenceR = 10.01;
    const centerReading = 25.0;
    const pairs = DEMO_ORDERS.map((order, index) => {
      const idealDiameter = order === 0
        ? 0
        : Math.sqrt(4 * referenceR * (wavelengthNm * 1e-9) * order) * 1000;
      const jitter = Math.sin(index * 1.37 + 0.4) * 0.0028 * idealDiameter;
      const diameterMm = idealDiameter + jitter;
      let leftMm = order === 0
        ? centerReading
        : centerReading - diameterMm / 2 + Math.sin(index * 0.7) * 0.0015;
      let rightMm = order === 0
        ? centerReading
        : centerReading + diameterMm / 2 + Math.cos(index * 0.8) * 0.0015;
      const captureIssues = new Map([
        ["12:right", { shiftMm: -0.085, latencyMs: 18, flag: "encoder-reversal" }],
        ["18:left", { shiftMm: 0.065, latencyMs: 18, flag: "encoder-reversal" }],
        ["24:right", { shiftMm: -0.050, latencyMs: 18, flag: "encoder-reversal" }]
      ]);
      const leftIssue = captureIssues.get(`${order}:left`);
      const rightIssue = captureIssues.get(`${order}:right`);
      if (leftIssue) leftMm += leftIssue.shiftMm;
      if (rightIssue) rightMm += rightIssue.shiftMm;
      const measuredDiameter = Math.abs(rightMm - leftMm);
      const capturedAt = new Date(started.getTime() + (index + 1) * 64000).toISOString();
      const confidence = 0.928 + Math.sin(index * 1.1) * 0.018;
      return {
        order,
        left: {
          id: uid("measure"),
          side: "left",
          order,
          positionMm: leftMm,
          raw: Math.round((leftMm / DEFAULT_SETTINGS.pitchMm) * DEFAULT_SETTINGS.countsPerRev),
          angleDeg: ((leftMm / DEFAULT_SETTINGS.pitchMm) * 360) % 360,
          confidence,
          latencyMs: leftIssue?.latencyMs ?? 18,
          directionWarning: leftIssue?.flag === "encoder-reversal",
          deviceFlag: leftIssue?.flag ?? null,
          capturedAt
        },
        right: {
          id: uid("measure"),
          side: "right",
          order,
          positionMm: rightMm,
          raw: Math.round((rightMm / DEFAULT_SETTINGS.pitchMm) * DEFAULT_SETTINGS.countsPerRev),
          angleDeg: ((rightMm / DEFAULT_SETTINGS.pitchMm) * 360) % 360,
          confidence,
          latencyMs: rightIssue?.latencyMs ?? 18,
          directionWarning: rightIssue?.flag === "encoder-reversal",
          deviceFlag: rightIssue?.flag ?? null,
          capturedAt: new Date(Date.parse(capturedAt) + 18000).toISOString()
        },
        diameterMm: measuredDiameter,
        diameterSquared: measuredDiameter ** 2,
        confidence,
        createdAt: capturedAt
      };
    });
    const studentReadings = pairs.map((pair, index) => ({
      order: pair.order,
      leftMm: pair.left.positionMm + 0.0180 + Math.sin(index * 0.45) * 0.0007,
      rightMm: pair.right.positionMm + 0.0180 + Math.cos(index * 0.38) * 0.0007
    }));
    const studentByOrder = new Map(studentReadings.map((reading) => [reading.order, reading]));
    const misread24 = studentByOrder.get(24);
    if (misread24) misread24.leftMm += 0.1800;
    const backlash12 = studentByOrder.get(12);
    if (backlash12) backlash12.rightMm -= 0.1100;
    const backlash18 = studentByOrder.get(18);
    if (backlash18) backlash18.leftMm += 0.0850;
    const missing8 = studentByOrder.get(8);
    if (missing8) missing8.rightMm = null;
    const events = [
      {
        id: uid("event"),
        type: "session",
        title: "演示会话已初始化",
        detail: "编码器、目镜视野与判读服务处于模拟联动状态",
        at: started.toISOString()
      },
      {
        id: uid("event"),
        type: "encoder",
        title: "编码器零点已记录",
        detail: "换算系数：1.000 mm/rev · 8192 counts/rev",
        at: new Date(started.getTime() + 9000).toISOString()
      },
      {
        id: uid("event"),
        type: "camera",
        title: "目镜视野接入",
        detail: "1196 × 994 · 30 FPS 演示视频",
        at: new Date(started.getTime() + 12000).toISOString()
      },
      {
        id: uid("event"),
        type: "encoder",
        title: "检测到编码器回转",
        detail: "m=12 右侧测点前记录到鼓轮反向转动，读数可能包含螺纹空程",
        at: new Date(started.getTime() + 13 * 64000).toISOString()
      },
      {
        id: uid("event"),
        type: "encoder",
        title: "检测到编码器回转",
        detail: "m=18 左侧测点前出现方向切换，建议越过目标后单向靠近复测",
        at: new Date(started.getTime() + 19 * 64000).toISOString()
      },
      {
        id: uid("event"),
        type: "encoder",
        title: "检测到编码器回转",
        detail: "m=24 右侧测点前发生反向转动，已记录原始计数与角度",
        at: new Date(started.getTime() + 25 * 64000).toISOString()
      },
      ...pairs.map((pair, index) => ({
        id: uid("event"),
        type: "pair",
        title: `第 ${pair.order} 级暗环完成配对`,
        detail: `D = ${rounded(pair.diameterMm, 4)} mm · D² = ${rounded(pair.diameterSquared, 4)} mm²`,
        at: new Date(Date.parse(pair.createdAt) + (index + 1) * 1000).toISOString()
      }))
    ];

    return {
      id: uid("session"),
      code: "NR-20261028-01",
      student: "演示实验者",
      group: "第 03 组",
      lens: "L-01",
      deviceId: "NR-FUSION-01",
      wavelengthNm,
      referenceR,
      fitMode: "intercept",
      residualThreshold: 2.5,
      studentResultR: 10.350,
      studentUncertaintyR: 0.1200,
      studentMethod: "逐差法",
      studentReadings,
      startedAt: started.toISOString(),
      elapsedMs: 12 * 60 * 1000 + 47 * 1000,
      status: "active",
      demo: true,
      demoVersion: DEMO_DATA_VERSION,
      pairs,
      ringSequence: {
        calibrationRatio: DEFAULT_CALIBRATION_RATIO,
        calibrationVersion: CALIBRATION_VERSION,
        deadZonePx: 6,
        matchDistancePx: 100,
        phase: "left",
        startOrder: 30,
        currentOrder: 1,
        rightCount: 30,
        leftCount: 30,
        crossingDirection: -1,
        completed: true,
        lastCrossingAt: new Date(started.getTime() + 31 * 64000).toISOString()
      },
      captures: pairs.flatMap((pair) => [pair.left, pair.right]),
      events,
      version: "fusion-1.0"
    };
  }

  function normalizeSession(session) {
    if (session?.demo && Number(session.demoVersion || 0) < DEMO_DATA_VERSION) {
      return buildDemoSession();
    }
    if (!session || !Array.isArray(session.pairs) || !Array.isArray(session.events)) {
      return buildDemoSession();
    }
    return {
      ...buildDemoSession(),
      ...session,
      pairs: session.pairs.filter((pair) => pair && Number.isFinite(Number(pair.order))),
      captures: Array.isArray(session.captures) ? session.captures : [],
      events: session.events.filter((event) => event && event.title),
      wavelengthNm: numberOr(session.wavelengthNm, 589.3),
      referenceR: numberOr(session.referenceR, 1),
      residualThreshold: numberOr(session.residualThreshold, 2.5),
      fitMode: session.fitMode === "origin" ? "origin" : "intercept",
      studentResultR: session.studentResultR == null ? null : numberOr(session.studentResultR, null),
      studentUncertaintyR: session.studentUncertaintyR == null ? null : numberOr(session.studentUncertaintyR, null),
      studentMethod: session.studentMethod || "逐差法",
      studentReadings: Array.isArray(session.studentReadings)
        ? session.studentReadings
          .filter((reading) => reading && Number.isFinite(Number(reading.order)))
          .map((reading) => ({
            order: Math.round(Number(reading.order)),
            leftMm: reading.leftMm == null ? null : numberOr(reading.leftMm, null),
            rightMm: reading.rightMm == null ? null : numberOr(reading.rightMm, null)
          }))
        : []
    };
  }

  const storedSettings = loadJson(SETTINGS_KEY, {});
  if (Number(storedSettings.settingsVersion || 0) < 2) {
    storedSettings.pitchMm = DEFAULT_SETTINGS.pitchMm;
  }
  if (Number(storedSettings.settingsVersion || 0) < 3) {
    storedSettings.ringBase = DEFAULT_SETTINGS.ringBase;
  }
  if (Number(storedSettings.settingsVersion || 0) < 4) {
    storedSettings.visionInterval = DEFAULT_SETTINGS.visionInterval;
  }
  if (Number(storedSettings.settingsVersion || 0) === 5) {
    storedSettings.countsPerRev = DEFAULT_SETTINGS.countsPerRev;
    storedSettings.pitchMm = DEFAULT_SETTINGS.pitchMm;
    storedSettings.wsUrl = DEFAULT_SETTINGS.wsUrl;
  }
  if (Number(storedSettings.settingsVersion || 0) < 8) {
    storedSettings.visionInterval = DEFAULT_SETTINGS.visionInterval;
  }
  const settings = {
    ...DEFAULT_SETTINGS,
    ...storedSettings,
    settingsVersion: 8
  };
  if (Number(storedSettings.settingsVersion || 0) !== settings.settingsVersion) {
    saveJson(SETTINGS_KEY, settings);
  }

  const storedSession = loadJson(SESSION_KEY, null);
  const state = {
    view: "live",
    session: normalizeSession(storedSession),
    settings,
    encoder: {
      mode: "demo",
      raw: 0,
      countsPerRev: settings.countsPerRev,
      pitchMm: settings.pitchMm,
      zeroOffsetMm: settings.zeroOffsetMm,
      direction: settings.direction,
      angleDeg: 0,
      positionMm: 0,
      latencyMs: 18,
      sampleRate: 50,
      lastDemoRaw: 0,
      mainScaleBaselineRaw: null,
      lastHardwareRaw: null,
      relativeMm: 0,
      syncValueMm: null,
      deviceTimeMs: null,
      demoDirection: 1,
      demoPauseUntil: 0,
      lastTimestamp: Date.now(),
      previousPosition: null
    },
    camera: {
      active: false,
      stream: null,
      video: null,
      demoVideo: null,
      demoVideoReady: false,
      rotationCanvas: null,
      frameFrozen: false,
      lastVideoFrame: null
    },
    vision: {
      status: "idle",
      analyzing: false,
      ringOrder: 20,
      confidence: 0.936,
      center: { x: 640, y: 360 },
      ringRadii: [],
      latencyMs: 184,
      lastAt: null,
      serviceOnline: false,
      syntheticCenter: { x: 640, y: 360 },
      syntheticRings: [],
      detectedRings: [],
      centralDarkSpot: null,
      lastCentralAt: 0,
      grayCurve: {
        profile: [],
        smoothed: [],
        valleys: [],
        smoothingWindow: 0,
        profileHalfWidth: 0
      },
      lockUntil: 0,
      lastAutoRecordAt: 0,
      lastAutoErrorAt: 0
    },
    currentRingOrder: settings.ringBase,
    manualRingUntil: 0,
    overlayEnabled: !EMBED_MODE,
    esp: {
      source: null,
      status: "idle",
      base: "",
      lastValueMm: null,
      previousValueMm: null,
      lastDeviceTimeMs: null,
      lastReceivedAt: null,
      sampleCount: 0,
      baselineValueMm: null,
      relativeMm: 0,
      modelAnchorMm: numberOr(settings.startPositionMm, MEASUREMENT_MAX_MM / 2),
      reconnectTimer: null
    },
    ringSummary: {
      status: "idle",
      rows: [],
      activeIndex: null,
      pendingIndex: null,
      lastDetectedAt: null
    },
    ringSequence: {
      tracks: new Map(),
      nextTrackId: 1,
      calibrationRatio: DEFAULT_CALIBRATION_RATIO,
      calibrationVersion: CALIBRATION_VERSION,
      deadZonePx: 0,
      matchDistancePx: 0,
      phase: "left",
      startOrder: Math.max(1, Math.round(numberOr(settings.ringBase, 1))),
      currentOrder: Math.max(1, Math.round(numberOr(settings.ringBase, 1))),
      rightCount: 0,
      leftCount: 0,
      crossingDirection: 0,
      cooldownFrames: 0,
      completed: false,
      lastCrossingAt: null
    },
    ws: null,
    wsReconnectTimer: null,
    serial: {
      port: null,
      reader: null,
      active: false
    },
    storage: {
      backendOnline: false,
      syncing: false,
      lastSavedAt: null,
      timer: null
    },
    archive: {
      items: [],
      loading: false
    },
    lastTick: performance.now(),
    lastClockSecond: -1,
    modelViewer: null,
    modelLoadStarted: false,
    liveModelViewer: null,
    liveModelLoadStarted: false,
    demoMotion: true,
    demoPausedByUser: false,
    demoClockMs: performance.now(),
    encoderMonitor: {
      samples: [],
      paused: false,
      lastSampleAt: 0,
      lastDrawAt: 0,
      limit: 600
    },
      measurementMotion: {
        lastCapturePosition: null,
        direction: 0,
        lastCaptureAt: null,
        lastRaw: null,
        recentLatencies: []
      },
    visionTimer: null,
    lastPersistAt: 0
  };

  state.encoder.lastDemoRaw = encoderRawForPosition(configuredStartPositionMm());
  state.encoder.raw = state.encoder.lastDemoRaw;
  state.encoder.angleDeg = normalizeAngle(
    state.encoder.raw / Math.max(1, state.encoder.countsPerRev) * 360
  );
  state.encoder.positionMm = configuredStartPositionMm();
  state.encoder.relativeMm = 0;
  state.currentRingOrder = clamp(state.session.pairs.at(-1)?.order ?? settings.ringBase, 1, 80);
  state.vision.ringOrder = state.currentRingOrder;
  restoreRingSummaryFromSession();

  function encoderPosition(raw, overrides = {}) {
    const countsPerRev = Math.max(1, numberOr(overrides.countsPerRev, numberOr(settings.countsPerRev, 8192)));
    const pitch = numberOr(overrides.pitchMm, numberOr(settings.pitchMm, 0.5));
    const directionValue = numberOr(overrides.direction, settings.direction === -1 ? -1 : 1);
    const direction = directionValue === -1 ? -1 : 1;
    const zeroOffset = numberOr(overrides.zeroOffsetMm, numberOr(settings.zeroOffsetMm, 0));
    return clamp(
      zeroOffset + direction * (raw / countsPerRev) * pitch,
      MEASUREMENT_MIN_MM,
      MEASUREMENT_MAX_MM
    );
  }

  function encoderRawForPosition(positionMm) {
    const countsPerRev = Math.max(1, numberOr(settings.countsPerRev, 8192));
    const pitchMm = Math.max(0.0001, numberOr(settings.pitchMm, 1));
    const direction = settings.direction === -1 ? -1 : 1;
    const zeroOffset = numberOr(settings.zeroOffsetMm, 0);
    const boundedPosition = clamp(
      positionMm,
      MEASUREMENT_MIN_MM,
      MEASUREMENT_MAX_MM
    );
    return (boundedPosition - zeroOffset) / (pitchMm * direction) * countsPerRev;
  }

  function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function setStatusChip(prefix, status, text) {
    const dot = $(`${prefix}StatusDot`);
    const label = $(`${prefix}StatusText`);
    if (dot) {
      dot.classList.toggle("online", status === "online");
      dot.classList.toggle("error", status === "error");
    }
    if (label) label.textContent = text;
  }

  function addEvent(type, title, detail, options = {}) {
    const event = {
      id: uid("event"),
      type,
      title,
      detail,
      at: options.at || new Date().toISOString(),
      severity: options.severity || "normal"
    };
    state.session.events.push(event);
    if (state.session.events.length > 240) {
      state.session.events = state.session.events.slice(-240);
    }
    if (!options.silent) {
      renderActivity();
      renderFullTimeline();
      persistSession(true);
    }
    return event;
  }

  function allPairs() {
    return [...state.session.pairs].sort((a, b) => Number(a.order) - Number(b.order));
  }

  function currentPair() {
    return state.session.pairs.find((pair) => Number(pair.order) === Number(state.currentRingOrder));
  }

  function sortedPairs() {
    return allPairs().filter((pair) => pair.left && pair.right && Number.isFinite(Number(pair.diameterSquared)));
  }

  function studentReadingFor(order) {
    return state.session.studentReadings.find((reading) => Number(reading.order) === Number(order)) || null;
  }

  function setStudentReading(order, side, value) {
    if (!["left", "right"].includes(side)) return;
    const numeric = String(value ?? "").trim() === "" ? null : numberOr(value, null);
    let reading = studentReadingFor(order);
    if (!reading) {
      reading = { order: Math.round(Number(order)), leftMm: null, rightMm: null };
      state.session.studentReadings.push(reading);
    }
    reading[side === "left" ? "leftMm" : "rightMm"] = numeric;
    if (reading.leftMm == null && reading.rightMm == null) {
      state.session.studentReadings = state.session.studentReadings.filter(
        (item) => Number(item.order) !== Number(order)
      );
    }
  }

  function studentComparisonRows() {
    const pairsByOrder = new Map(
      state.session.pairs.map((pair) => [Number(pair.order), pair])
    );
    const orders = new Set(sequenceDisplayRows().map((row) => Number(row.order)));
    state.session.pairs.forEach((pair) => orders.add(Number(pair.order)));
    return Array.from(orders)
      .sort((left, right) => right - left)
      .map((order) => {
      const student = studentReadingFor(order);
      const pair = pairsByOrder.get(Number(order));
      const studentLeft = student?.leftMm == null ? null : Number(student.leftMm);
      const studentRight = student?.rightMm == null ? null : Number(student.rightMm);
      const platformLeft = pair?.left ? Number(pair.left.positionMm) : null;
      const platformRight = pair?.right ? Number(pair.right.positionMm) : null;
      const leftDiff = Number.isFinite(studentLeft) && Number.isFinite(platformLeft)
        ? studentLeft - platformLeft
        : null;
      const rightDiff = Number.isFinite(studentRight) && Number.isFinite(platformRight)
        ? studentRight - platformRight
        : null;
      const studentDiameter = Number.isFinite(studentLeft) && Number.isFinite(studentRight)
        ? Math.abs(studentRight - studentLeft)
        : null;
      const platformDiameter = pair?.left && pair?.right
        ? Number(pair.diameterMm)
        : null;
      const diameterDiff = Number.isFinite(studentDiameter) && Number.isFinite(platformDiameter)
        ? studentDiameter - platformDiameter
        : null;
      return {
        order,
        studentLeft,
        studentRight,
        platformLeft,
        platformRight,
        leftDiff,
        rightDiff,
        studentDiameter,
        platformDiameter,
        diameterDiff
      };
    });
  }

  function summarizeStudentComparison() {
    const rows = studentComparisonRows().filter((row) =>
      Number.isFinite(row.studentLeft)
      && Number.isFinite(row.studentRight)
      && Number.isFinite(row.platformLeft)
      && Number.isFinite(row.platformRight)
    );
    if (!rows.length) return null;
    const largest = rows.reduce((best, row) =>
      !best || Math.abs(row.diameterDiff) > Math.abs(best.diameterDiff) ? row : best
    , null);
    return {
      count: rows.length,
      meanAbsLeftDiff: mean(rows.map((row) => Math.abs(row.leftDiff)).filter(Number.isFinite)),
      meanAbsRightDiff: mean(rows.map((row) => Math.abs(row.rightDiff)).filter(Number.isFinite)),
      largest
    };
  }

  function studentComparisonValue(value) {
    return Number.isFinite(value) ? Number(value).toFixed(3) : "--";
  }

  function studentComparisonDiff(value) {
    if (!Number.isFinite(value)) return `<td class="student-diff">--</td>`;
    const level = Math.abs(value) > 0.003 ? "warn" : "good";
    return `<td class="student-diff ${level}">${signed(value, 3)}</td>`;
  }

  function updateStudentComparisonBadge(rows = studentComparisonRows()) {
    const badge = $("studentCompareBadge");
    if (!badge) return;
    const entered = rows.filter((row) =>
      Number.isFinite(row.studentLeft) && Number.isFinite(row.studentRight)
    ).length;
    badge.textContent = `${entered} / ${rows.length} 已录入`;
  }

  function updateStudentComparisonRow(order) {
    const row = studentComparisonRows().find((item) => Number(item.order) === Number(order));
    const element = document.querySelector(`[data-student-order="${Number(order)}"]`);
    if (!row || !element) return;
    const cells = element.querySelectorAll("td");
    cells[3].textContent = studentComparisonValue(row.platformLeft);
    cells[4].textContent = studentComparisonValue(row.platformRight);
    cells[5].outerHTML = studentComparisonDiff(row.leftDiff);
    cells[6].outerHTML = studentComparisonDiff(row.rightDiff);
    cells[7].textContent = studentComparisonValue(row.studentDiameter);
    cells[8].textContent = studentComparisonValue(row.platformDiameter);
    cells[9].outerHTML = studentComparisonDiff(row.diameterDiff);
    updateStudentComparisonBadge();
  }

  function computeFit() {
    const pairs = sortedPairs();
    if (pairs.length < 2) return null;
    const xs = pairs.map((pair) => Number(pair.order));
    const ys = pairs.map((pair) => Number(pair.diameterSquared));
    if (xs.some((value) => !Number.isFinite(value)) || ys.some((value) => !Number.isFinite(value))) {
      return null;
    }
    const xMean = mean(xs);
    const yMean = mean(ys);
    const throughOrigin = state.session.fitMode === "origin";
    let slope;
    let intercept;
    let sxx;

    if (throughOrigin) {
      sxx = sum(xs.map((value) => value ** 2));
      slope = sum(xs.map((value, index) => value * ys[index])) / sxx;
      intercept = 0;
    } else {
      sxx = sum(xs.map((value) => (value - xMean) ** 2));
      slope = sum(xs.map((value, index) => (value - xMean) * (ys[index] - yMean))) / sxx;
      intercept = yMean - slope * xMean;
    }

    const fitted = xs.map((value) => slope * value + intercept);
    const residuals = ys.map((value, index) => value - fitted[index]);
    const ssRes = sum(residuals.map((value) => value ** 2));
    const ssTot = throughOrigin
      ? sum(ys.map((value) => value ** 2))
      : sum(ys.map((value) => (value - yMean) ** 2));
    const degrees = Math.max(1, xs.length - (throughOrigin ? 1 : 2));
    const residualStd = Math.sqrt(ssRes / degrees);
    const slopeStd = residualStd / Math.sqrt(Math.max(sxx, Number.EPSILON));
    const wavelengthNm = Math.max(1, numberOr(state.session.wavelengthNm, 589.3));
    const rMeters = slope * 250 / wavelengthNm;
    const uncertaintyR = slopeStd * 250 / wavelengthNm;
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const referenceR = Math.max(0.001, numberOr(state.session.referenceR, 1));
    const relativeError = (rMeters - referenceR) / referenceR * 100;
    const residualSigma = residualStd > 0
      ? residuals.map((value) => value / residualStd)
      : residuals.map(() => 0);

    return {
      pairs,
      xs,
      ys,
      slope,
      intercept,
      fitted,
      residuals,
      residualSigma,
      ssRes,
      residualStd,
      slopeStd,
      rMeters,
      uncertaintyR,
      r2,
      relativeError,
      wavelengthNm,
      referenceR,
      throughOrigin,
      equation: `D² = ${slope.toFixed(6)} · m ${intercept >= 0 ? "+" : "−"} ${Math.abs(intercept).toFixed(6)}`
    };
  }

  function computeStudentComparison(fit) {
    if (!fit) return null;
    const rawValue = state.session.studentResultR;
    if (rawValue == null || rawValue === "") return null;
    const studentR = Number(rawValue);
    if (!Number.isFinite(studentR) || studentR <= 0) return null;
    const difference = fit.rMeters - studentR;
    const differencePercent = difference / studentR * 100;
    const absolutePercent = Math.abs(differencePercent);
    const severity = absolutePercent <= 1.5 ? "good" : absolutePercent <= 3.5 ? "warn" : "error";
    const label = severity === "good" ? "一致性良好" : severity === "warn" ? "需复核差异" : "差异显著";
    return {
      studentR,
      studentUncertaintyR: state.session.studentUncertaintyR == null
        ? null
        : Number(state.session.studentUncertaintyR),
      method: state.session.studentMethod || "未注明",
      difference,
      differencePercent,
      absolutePercent,
      severity,
      label
    };
  }

  function generateDiagnostics() {
    const fit = computeFit();
    const findings = [];
    const recommendations = [];
    let score = 100;
    const pairs = sortedPairs();
    const pendingCaptures = getPendingCaptures();
    const averageConfidence = pairs.length
      ? mean(pairs.map((pair) => numberOr(pair.confidence, 0)))
      : 0;
    const encoderLatency = state.encoder.latencyMs;
    const confidenceThreshold = 0.78;

    if (!fit) {
      findings.push({
        severity: "warn",
        title: "有效数据不足",
        detail: "至少需要两组同环级的左右测点才能进行线性拟合。"
      });
      recommendations.push("继续完成不同暗环级次的左右测点配对，建议覆盖连续 8–10 个级次。");
      score = pairs.length ? 48 : 0;
      return {
        fit: null,
        findings,
        recommendations,
        score,
        averageConfidence,
        pendingCaptures,
        encoderLatency,
        summary: "当前尚不足以形成可靠的曲率半径估计。"
      };
    }

    if (Math.abs(fit.relativeError) <= 1.5) {
      findings.push({
        severity: "good",
        title: "测得结果与参考值一致",
        detail: `R = ${fit.rMeters.toFixed(3)} m，相对偏差 ${signed(fit.relativeError, 2)}%，处于 1.5% 诊断带内。`
      });
    } else if (Math.abs(fit.relativeError) <= 3.5) {
      findings.push({
        severity: "warn",
        title: "结果存在可解释的系统偏差",
        detail: `R = ${fit.rMeters.toFixed(3)} m，相对偏差 ${signed(fit.relativeError, 2)}%，建议检查环级映射与鼓轮零点。`
      });
      score -= 10;
      recommendations.push("复核起始暗环级次和编码器零点，确认左右测点属于同一干涉级次。");
    } else {
      findings.push({
        severity: "error",
        title: "结果偏差超出教学容差",
        detail: `R = ${fit.rMeters.toFixed(3)} m，相对偏差 ${signed(fit.relativeError, 2)}%。先排查级次、单位与螺距参数。`
      });
      score -= 24;
      recommendations.push("优先检查波长单位、螺距参数、编码器方向以及环级基准是否同时正确。");
    }

    if (fit.r2 >= 0.995) {
      findings.push({
        severity: "good",
        title: "D²–m 线性关系良好",
        detail: `R² = ${fit.r2.toFixed(5)}，残差未表现出明显非线性结构。`
      });
    } else if (fit.r2 >= 0.98) {
      findings.push({
        severity: "warn",
        title: "数据线性尚可但存在离散",
        detail: `R² = ${fit.r2.toFixed(5)}，需结合逐个残差检查视觉判读与机械回程差。`
      });
      score -= 9;
      recommendations.push("保持鼓轮单向转动，并复核置信度较低的环级测点。");
    } else {
      findings.push({
        severity: "error",
        title: "线性拟合质量偏低",
        detail: `R² = ${fit.r2.toFixed(5)}，可能存在错级、重复读数、零点漂移或左右测点未配到同一暗环。`
      });
      score -= 22;
      recommendations.push("删去可疑环级后重新配对，并检查目镜十字叉丝是否始终对准暗环中心。");
    }

    const outlierLimit = numberOr(state.session.residualThreshold, 2.5);
    const outliers = fit.residualSigma
      .map((sigma, index) => ({ sigma, pair: fit.pairs[index] }))
      .filter((item) => Math.abs(item.sigma) > outlierLimit);
    if (outliers.length) {
      findings.push({
        severity: "warn",
        title: `${outliers.length} 个残差异常点`,
        detail: `环级 ${outliers.map((item) => `m=${item.pair.order}`).join("、")} 的残差超过 ${outlierLimit.toFixed(1)}σ。`
      });
      score -= Math.min(18, outliers.length * 4);
      recommendations.push("优先复核异常环级的左右读数是否跨级或存在图像判读置信度下降。");
    } else {
      findings.push({
        severity: "good",
        title: "未发现强残差异常点",
        detail: `所有配对残差均处于 ${outlierLimit.toFixed(1)}σ 证据阈值内。`
      });
    }

    if (averageConfidence >= confidenceThreshold) {
      findings.push({
        severity: "good",
        title: "视觉判读置信度稳定",
        detail: `配对测点平均置信度 ${(averageConfidence * 100).toFixed(1)}%，满足自动记录条件。`
      });
    } else {
      findings.push({
        severity: "warn",
        title: "视觉判读置信度偏低",
        detail: `平均置信度 ${(averageConfidence * 100).toFixed(1)}%，建议检查对焦、曝光和环纹清晰度。`
      });
      score -= 8;
      recommendations.push("重新对焦并降低环境杂光；对低置信度测点进行目视复核。");
    }

    const ringSamplePairs = pairs.filter((pair) => Number(pair.order) > 0);
    if (ringSamplePairs.length >= 8) {
      findings.push({
        severity: "good",
        title: "有效样本量充足",
        detail: `共有 ${ringSamplePairs.length} 组暗环左右配对，覆盖 ${ringSamplePairs[0].order}–${ringSamplePairs.at(-1).order} 级暗环${pairs.some((pair) => Number(pair.order) === 0) ? "，并包含中央 m=0 对照" : ""}。`
      });
    } else if (ringSamplePairs.length >= 5) {
      findings.push({
        severity: "warn",
        title: "样本量接近下限",
        detail: `当前 ${ringSamplePairs.length} 组暗环配对，建议补足到 8 组以上以提高回归稳定性。`
      });
      score -= 6;
      recommendations.push("继续增加中高级次暗环测点，避免仅使用相邻少数环级。");
    } else {
      findings.push({
        severity: "warn",
        title: "有效样本量不足",
        detail: `当前仅 ${ringSamplePairs.length} 组暗环配对，拟合结果容易受单点误差影响。`
      });
      score -= 15;
      recommendations.push("至少补足到 5 组，推荐完成 8–10 个连续级次的左右测点。");
    }

    if (pendingCaptures.length) {
      findings.push({
        severity: "warn",
        title: `${pendingCaptures.length} 个测点尚未配对`,
        detail: `环级 ${pendingCaptures.map((item) => `m=${item.order}`).join("、")} 仅记录了单侧位置。`
      });
      score -= Math.min(8, pendingCaptures.length);
      recommendations.push("补齐未配对环级的另一侧测点，确保直径均由同环级左右读数计算。");
    }

      const directionWarnings = state.session.captures.filter(
        (capture) => capture.directionWarning
      );
      if (directionWarnings.length) {
        const reversalOrders = [...new Set(directionWarnings.map((capture) => Number(capture.order)))].sort((left, right) => right - left);
        findings.push({
          severity: "warn",
          title: "检测到反向测量",
          detail: `${directionWarnings.length} 个测点在记录前反转鼓轮方向（m=${reversalOrders.join("、")}），违反单向读数要求，可能引入螺纹空程误差。`
        });
        score -= Math.min(12, directionWarnings.length * 3);
        recommendations.push("按同一方向完成整组读数；需要返回时先越过目标位置再单向靠近，或重新开始本组测量。");
        const affectedReversalOutliers = fit.residualSigma
          .map((sigma, index) => ({ sigma, pair: fit.pairs[index] }))
          .filter((item) =>
            reversalOrders.includes(Number(item.pair.order))
            && Math.abs(item.sigma) > numberOr(state.session.residualThreshold, 2.5)
          );
        if (affectedReversalOutliers.length) {
          findings.push({
            severity: "warn",
            title: "空程误差与反向测点位置吻合",
            detail: `${affectedReversalOutliers.map((item) => `m=${item.pair.order}（${signed(item.sigma, 1)}σ）`).join("、")} 同时具有方向反转记录和残差异常，支持螺纹空程误差判断。`
          });
        }
      }

    const captureLatencies = state.session.captures
      .map((capture) => numberOr(capture.latencyMs, null))
      .filter(Number.isFinite);
    let captureLatencySpikes = [];
    if (captureLatencies.length >= 4) {
      const sortedLatencies = captureLatencies.slice().sort((left, right) => left - right);
      const medianLatency = sortedLatencies[Math.floor(sortedLatencies.length / 2)];
      const latencyLimit = Math.max(180, medianLatency * 3);
      const latencySpikes = state.session.captures.filter(
        (capture) => numberOr(capture.latencyMs, 0) > latencyLimit
      );
      if (latencySpikes.length) {
        captureLatencySpikes = latencySpikes;
        const worst = latencySpikes.reduce((best, capture) =>
          numberOr(capture.latencyMs, 0) > numberOr(best?.latencyMs, 0) ? capture : best
        , null);
        findings.push({
          severity: "warn",
          title: "检测到编码器链路延迟尖峰",
          detail: `${latencySpikes.length} 个测点超过动态阈值 ${Math.round(latencyLimit)} ms，最大为 m=${worst?.order ?? "--"} ${worst?.side === "left" ? "左" : "右"}侧 ${Math.round(numberOr(worst?.latencyMs, 0))} ms。`
        });
        score -= Math.min(10, latencySpikes.length * 4);
        recommendations.push("检查串口缓冲、ESP8266 网络和编码器采样周期；延迟尖峰对应的测点应重新采集。");
      }
    }

    const encoderJumpWarnings = state.session.captures.filter(
      (capture) => capture.encoderJumpWarning || capture.deviceFlag === "encoder-count-jump"
    );
    if (encoderJumpWarnings.length) {
      findings.push({
        severity: "warn",
        title: "检测到编码器计数跳变",
        detail: `${encoderJumpWarnings.length} 个测点在过短采样间隔内出现异常计数变化，可能由丢步、回转或通信重传造成。`
      });
      score -= Math.min(10, encoderJumpWarnings.length * 4);
      recommendations.push("检查编码器信号线、供电和采样缓冲，并对计数跳变前后的测点重新采集。");
    }

    if (encoderLatency > 250) {
      findings.push({
        severity: "warn",
        title: "编码器链路延迟偏高",
        detail: `最近延迟 ${Math.round(encoderLatency)} ms，捕获事件与画面可能存在可感知错位。`
      });
      score -= 6;
      recommendations.push("检查串口波特率、WebSocket 网络和编码器采样频率，建议端到端延迟低于 100 ms。");
    } else if (!captureLatencySpikes.length) {
      findings.push({
        severity: "good",
        title: "编码器链路延迟正常",
        detail: `最近延迟 ${Math.round(encoderLatency)} ms，测点冻结与目镜帧保持同步。`
      });
    }

    if (state.session.demo) {
      findings.push({
        severity: "warn",
        title: "当前会话包含演示数据",
        detail: "连接真实编码器和摄像头后，请新建实验会话再开始正式记录。"
      });
    }

    const comparison = computeStudentComparison(fit);
    if (comparison) {
      if (comparison.severity === "good") {
        findings.unshift({
          severity: "good",
          title: "平台结果与学生核算一致",
          detail: `学生采用${comparison.method}得到 R = ${comparison.studentR.toFixed(3)} m，与平台拟合值相差 ${signed(comparison.difference, 3)} m（${signed(comparison.differencePercent, 2)}%）。`
        });
      } else if (comparison.severity === "warn") {
        findings.unshift({
          severity: "warn",
          title: "平台结果与学生核算存在差异",
          detail: `学生 R = ${comparison.studentR.toFixed(3)} m，与平台值相差 ${signed(comparison.differencePercent, 2)}%，建议复核公式、单位和逐差级次。`
        });
        score -= 5;
        recommendations.push("对照学生逐差过程与平台线性拟合过程，重点检查是否使用了同一组原始读数。");
      } else {
        findings.unshift({
          severity: "error",
          title: "平台结果与学生核算差异显著",
          detail: `两种方法相差 ${signed(comparison.differencePercent, 2)}%，通常意味着级次配对、单位换算或公式使用存在不一致。`
        });
        score -= 14;
        recommendations.push("逐条核对左右测点、环级序号、波长单位以及所用曲率半径公式。");
      }
    } else {
      recommendations.push("录入学生手工核算得到的 R，让平台结果、学生结果与原始数据形成三方对照。");
    }

    const studentRaw = summarizeStudentComparison();
    const studentRows = studentComparisonRows().filter((row) =>
      Number.isFinite(row.platformLeft) && Number.isFinite(row.platformRight)
    );
    const missingStudentRows = studentRows.filter((row) =>
      !Number.isFinite(row.studentLeft) || !Number.isFinite(row.studentRight)
    );
    const abnormalStudentRows = studentRows.filter((row) =>
      Number.isFinite(row.diameterDiff) && Math.abs(row.diameterDiff) > 0.020
    );
    if (missingStudentRows.length) {
      findings.push({
        severity: "warn",
        title: "学生逐环数据不完整",
        detail: `环级 ${missingStudentRows.map((row) => `m=${row.order}`).join("、")} 缺少一侧或两侧读数，无法完成逐环直径对照。`
      });
      score -= Math.min(10, missingStudentRows.length * 2);
      recommendations.push("补齐缺失的学生左右读数，避免最终 R 由不完整数据计算。");
    }
    if (studentRaw && (studentRaw.meanAbsLeftDiff > 0.010 || studentRaw.meanAbsRightDiff > 0.010)) {
      findings.push({
        severity: "warn",
        title: "学生读数存在整体偏移",
        detail: `学生左右读数平均绝对差分别为 ${studentRaw.meanAbsLeftDiff.toFixed(3)} mm 和 ${studentRaw.meanAbsRightDiff.toFixed(3)} mm，可能存在零点或标定线读数偏差。`
      });
      score -= 8;
      recommendations.push("核对学生起始读数、固定标定线和编码器零位；整体同向偏移通常不是单环判读问题。");
    }
    if (abnormalStudentRows.length) {
      findings.push({
        severity: abnormalStudentRows.length >= 2 ? "error" : "warn",
        title: "学生逐环数据存在典型异常",
        detail: abnormalStudentRows.map((row) =>
          `m=${row.order} 的 D 差值为 ${signed(row.diameterDiff, 4)} mm`
        ).join("；")
      });
      score -= Math.min(18, abnormalStudentRows.length * 5);
      recommendations.push("优先复核 D 差值最大的环级，检查是否错级、回程空程、中央暗斑误计或单侧读数抄错。");
    }

    score = clamp(Math.round(score - Math.min(18, Math.abs(fit.relativeError) * 2.5)), 0, 100);
    let summary;
    if (score >= 88) {
      summary = "数据链路稳定，拟合结果与线性证据一致，可作为有效实验记录。";
    } else if (score >= 72) {
      summary = "实验结果基本可用，但仍有可复核的系统偏差或离散点。";
    } else {
      summary = "当前结果可靠性不足，应先排查级次、零点、视觉判读与配对关系。";
    }

    if (!recommendations.length) {
      recommendations.push("保持现有操作方式，并在报告中保留原始计数、图像帧和测点时间戳。");
    }

    const deviceIssuePattern = /反向测量|空程误差|延迟尖峰|计数跳变|链路延迟/;
    findings.sort((left, right) =>
      Number(!deviceIssuePattern.test(left.title)) - Number(!deviceIssuePattern.test(right.title))
    );

    return {
      fit,
      findings,
      recommendations: [...new Set(recommendations)],
      score,
      averageConfidence,
      pendingCaptures,
      encoderLatency,
      comparison,
      summary
    };
  }

  function getPendingCaptures() {
    return allPairs()
      .filter((pair) => !pair.left || !pair.right)
      .map((pair) => ({
        order: Number(pair.order),
        left: Boolean(pair.left),
        right: Boolean(pair.right)
      }));
  }

  function persistSession(force = false) {
    const now = Date.now();
    if (!force && now - state.lastPersistAt < 900) return;
    state.lastPersistAt = now;
    const success = saveJson(SESSION_KEY, state.session);
    if (!success && force) {
      toast("存储空间不足", "实验记录仍保留在内存中，请及时导出 JSON。", "warn");
    }
    queueBackendSave();
  }

  function queueBackendSave(delay = 650) {
    if (!state.storage.backendOnline) return;
    if (state.storage.timer) window.clearTimeout(state.storage.timer);
    state.storage.timer = window.setTimeout(syncSessionToBackend, delay);
  }

  async function syncSessionToBackend() {
    if (!state.storage.backendOnline || state.storage.syncing) return;
    state.storage.syncing = true;
    setStatusChip("storage", "warn", "档案同步中");
    try {
      const response = await fetchWithTimeout("api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: state.session })
      }, 8000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "save failed");
      state.storage.lastSavedAt = payload.savedAt || new Date().toISOString();
      setStatusChip("storage", "online", "档案已同步");
      if (state.view === "process") {
        loadBackendSessions(true);
      }
    } catch (error) {
      console.warn("Backend save unavailable:", error);
      state.storage.backendOnline = false;
      setStatusChip("storage", "local", "本地记录");
    } finally {
      state.storage.syncing = false;
      state.storage.timer = null;
    }
  }

  async function probePlatformBackend() {
    try {
      const response = await fetchWithTimeout("api/health", {
        method: "GET",
        cache: "no-store"
      }, 2500);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.service !== "newton-rings-platform") throw new Error("not platform server");
      state.storage.backendOnline = true;
      setStatusChip("storage", "online", "档案已连接");
      queueBackendSave(100);
      loadBackendSessions(true);
    } catch (error) {
      state.storage.backendOnline = false;
      setStatusChip("storage", "local", "本地记录");
    }
  }

  function beaconSession() {
    if (!state.storage.backendOnline || !navigator.sendBeacon) return;
    const body = new Blob(
      [JSON.stringify({ session: state.session })],
      { type: "application/json" }
    );
    navigator.sendBeacon("api/sessions", body);
  }

  async function loadBackendSessions(silent = true) {
    if (!state.storage.backendOnline) {
      state.archive.items = [];
      renderBackendArchive("当前为本地记录模式。启动 platform_server.py 后，历史会话会显示在这里。");
      return;
    }
    if (state.archive.loading) return;
    state.archive.loading = true;
    if (!silent) renderBackendArchive("正在刷新档案...");
    try {
      const response = await fetchWithTimeout("api/sessions", {
        method: "GET",
        cache: "no-store"
      }, 5000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.archive.items = Array.isArray(payload.sessions) ? payload.sessions : [];
      renderBackendArchive();
    } catch (error) {
      state.archive.items = [];
      renderBackendArchive("档案服务暂时不可用。");
      if (!silent) toast("档案刷新失败", "请确认 platform_server.py 正在运行。", "warn");
    } finally {
      state.archive.loading = false;
    }
  }

  function renderBackendArchive(emptyText) {
    const container = $("backendArchiveList");
    if (!container) return;
    if (!state.archive.items.length) {
      container.innerHTML = `<div class="archive-empty">${escapeHtml(emptyText || "暂无已保存的实验会话")}</div>`;
      return;
    }
    container.innerHTML = state.archive.items.map((item) => `
      <article class="archive-item">
        <div>
          <strong>${escapeHtml(item.code || item.id)}</strong>
          <p>${escapeHtml(item.student || "未填写")} · ${escapeHtml(item.group || "未分组")} · ${numberOr(item.pairs, 0)} 组配对</p>
          <p>${item.savedAt ? escapeHtml(formatDateTime(item.savedAt)) : escapeHtml(item.startedAt || "--")}</p>
        </div>
        <button type="button" data-load-session="${escapeHtml(item.id)}">载入</button>
      </article>
    `).join("");
  }

  async function loadBackendSession(sessionId) {
    try {
      const response = await fetchWithTimeout(`api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "GET",
        cache: "no-store"
      }, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.ok || !payload.session) throw new Error(payload.error || "invalid session");
      const loaded = normalizeSession(payload.session);
      const currentHasWork = state.session.pairs.length || state.session.captures.length;
      if (currentHasWork && !window.confirm(`载入实验 ${loaded.code} 会替换当前会话，是否继续？`)) {
        return;
      }
      state.session = loaded;
      restoreRingSummaryFromSession();
      state.currentRingOrder = sortedPairs().at(-1)?.order ?? settings.ringBase;
      state.manualRingUntil = 0;
      renderAll();
      persistSession(true);
      toast("历史实验已载入", `${loaded.code} · ${loaded.student || "未填写实验者"}`);
    } catch (error) {
      console.error(error);
      toast("载入实验失败", "档案文件可能已移动或格式不兼容。", "error");
    }
  }

  function toast(title, message, type = "info") {
    const stack = $("toastStack");
    if (!stack) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    const icon = type === "error" ? "circle-x" : type === "warn" ? "triangle-alert" : "check-circle-2";
    item.innerHTML = `
      <i data-lucide="${icon}" aria-hidden="true"></i>
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>
    `;
    stack.appendChild(item);
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
    window.setTimeout(() => {
      item.style.opacity = "0";
      item.style.transform = "translateY(6px)";
      item.style.transition = "opacity 160ms ease, transform 160ms ease";
      window.setTimeout(() => item.remove(), 180);
    }, 4200);
  }

  function setButtonActive(button, active) {
    if (!button) return;
    button.classList.toggle("active", active);
  }

  function updateEncoderUI() {
    const encoder = state.encoder;
    const syncedReading = encoder.mode === "esp" && Number.isFinite(encoder.syncValueMm);
    const zeroedHardware = (encoder.mode === "esp" && Number.isFinite(state.esp.baselineValueMm))
      || (["ws", "serial"].includes(encoder.mode) && state.encoder.mainScaleBaselineRaw != null);
    const displayedReading = encoder.positionMm;
    $("encoderAngle").textContent = encoder.angleDeg.toFixed(2);
    $("positionReading").textContent = displayedReading.toFixed(3);
    $("syncReadingLabel").textContent = zeroedHardware ? "起始读数 + 相对位移" : "换算读数";
    $("rawValueLabel").textContent = zeroedHardware ? "编码器相对值" : "原始计数";
    $("deviceMetaLabel").textContent = syncedReading ? "设备时间" : "每转计数";
    $("rawCount").textContent = zeroedHardware
      ? `${signed(encoder.relativeMm, 4)} mm`
      : Math.round(encoder.raw).toLocaleString("en-US");
    $("countsPerRev").textContent = syncedReading && Number.isFinite(encoder.deviceTimeMs)
      ? `${Math.round(encoder.deviceTimeMs)} ms`
      : Math.round(encoder.countsPerRev).toLocaleString("en-US");
    $("encoderLatency").textContent = `${Math.round(encoder.latencyMs)} ms`;
    $("sampleRate").textContent = `${Math.round(encoder.sampleRate)} Hz`;
    $("encoderSource").textContent = encoder.mode === "esp"
      ? "ESP8266"
      : encoder.mode === "demo"
        ? "DEMO"
        : encoder.mode.toUpperCase();
    $("encoderSource").classList.toggle("online", encoder.mode !== "demo");
    $("positionDelta").textContent = encoder.previousPosition == null
      ? (syncedReading ? "起始位置已同步" : "等待下一帧")
      : `${signed(encoder.positionMm - encoder.previousPosition, 4)} mm / ${syncedReading ? "sample" : "frame"}`;
    updateStartPositionUI();

    if (encoder.mode === "demo") {
      setStatusChip("encoder", "demo", "模拟编码器");
    } else if (encoder.mode === "connecting") {
      setStatusChip("encoder", "warn", "编码器连接中");
    } else if (encoder.mode === "esp") {
      setStatusChip("encoder", "online", "ESP8266 同步");
    } else {
      setStatusChip("encoder", "online", encoder.mode === "serial" ? "串口编码器在线" : "编码器在线");
    }
    const liveSideCell = document.querySelector("#ringSummaryBody tr.active .ring-side-reading.live");
    if (liveSideCell) {
      liveSideCell.textContent = `${currentEncoderValue().toFixed(3)} mm`;
    }
  }

  function updateVisionUI() {
    const vision = state.vision;
    const sequence = state.ringSequence;
    const recordedCrossings = sequence.rightCount + sequence.leftCount;
    const totalCrossings = sequence.startOrder * 2;
    if (!sequence.completed) {
      state.currentRingOrder = sequence.currentOrder;
      vision.ringOrder = sequence.currentOrder;
    }
    $("stageRingOrder").textContent = sequence.completed ? "OK" : String(sequence.currentOrder);
    $("stageCenter").textContent = sequence.completed
      ? "顺序记录完成"
      : sequence.phase === "left" ? "左侧 · 递减" : "右侧 · 递增";
    $("stageConfidence").textContent = `${recordedCrossings}/${totalCrossings}`;
    $("stageSideLabel").textContent = sequence.completed
      ? "完成"
      : sequence.phase === "left" ? "左侧计数" : "右侧计数";
    $("stageSideLabel").dataset.side = sequence.completed
      ? "center"
      : sequence.phase;
    $("opticConfidence").textContent = `${vision.grayCurve.valleys.length} 谷`;
    $("opticOffset").textContent = `x ${Math.round(calibrationXPx())}`;
    $("opticLatency").textContent = `${Math.round(vision.latencyMs)} ms`;
    $("opticImageState").textContent = state.camera.active
      ? (state.camera.frameFrozen ? "已冻结" : "实时")
      : state.camera.demoVideoReady ? "演示视频" : "模拟画面";
    $("ringConfidence").textContent = `已记录 ${recordedCrossings} 次`;
    if (document.activeElement !== $("ringOrderInput")) {
      $("ringOrderInput").value = String(sequence.startOrder);
    }

    if (vision.status === "running") {
      setStatusChip("vision", "warn", "正在判读");
    } else if (vision.status === "error") {
      setStatusChip("vision", "error", "判读服务异常");
    } else if (vision.status === "ready") {
      setStatusChip("vision", "online", "灰度谷值顺序计数");
    } else if (vision.serviceOnline) {
      setStatusChip("vision", "online", "视觉服务在线");
    } else {
      setStatusChip("vision", "idle", "判读待命");
    }
  }

  function currentEncoderValue() {
    return state.encoder.positionMm;
  }

  function calibrationXPx() {
    const canvas = $("opticCanvas");
    return (canvas?.width || 1280) * clamp(numberOr(state.ringSequence.calibrationRatio, DEFAULT_CALIBRATION_RATIO), 0, 1);
  }

  function normalizedRingSequence(saved = {}) {
    const startOrder = clamp(
      Math.round(numberOr(saved.startOrder, settings.ringBase)),
      1,
      RING_MAX_DETECTED
    );
    return {
      tracks: new Map(),
      nextTrackId: 1,
      calibrationRatio: Number(saved.calibrationVersion) >= CALIBRATION_VERSION
        ? clamp(numberOr(saved.calibrationRatio, DEFAULT_CALIBRATION_RATIO), 0.05, 0.95)
        : DEFAULT_CALIBRATION_RATIO,
      calibrationVersion: CALIBRATION_VERSION,
      deadZonePx: Math.max(0, numberOr(saved.deadZonePx, 0)),
      matchDistancePx: Math.max(0, numberOr(saved.matchDistancePx, 0)),
      phase: saved.phase === "right" ? "right" : "left",
      startOrder,
      currentOrder: clamp(Math.round(numberOr(saved.currentOrder, startOrder)), 1, startOrder),
      rightCount: Math.max(0, Math.round(numberOr(saved.rightCount, 0))),
      leftCount: Math.max(0, Math.round(numberOr(saved.leftCount, 0))),
      crossingDirection: [-1, 0, 1].includes(Number(saved.crossingDirection))
        ? Number(saved.crossingDirection)
        : 0,
      cooldownFrames: 0,
      completed: Boolean(saved.completed),
      lastCrossingAt: saved.lastCrossingAt || null
    };
  }

  function ringSequenceSnapshot() {
    const sequence = state.ringSequence;
    return {
      calibrationRatio: sequence.calibrationRatio,
      calibrationVersion: CALIBRATION_VERSION,
      deadZonePx: sequence.deadZonePx,
      matchDistancePx: sequence.matchDistancePx,
      phase: sequence.phase,
      startOrder: sequence.startOrder,
      currentOrder: sequence.currentOrder,
      rightCount: sequence.rightCount,
      leftCount: sequence.leftCount,
      crossingDirection: sequence.crossingDirection,
      completed: sequence.completed,
      lastCrossingAt: sequence.lastCrossingAt
    };
  }

  function persistRingSequence() {
    state.session.ringSequence = ringSequenceSnapshot();
    state.session.ringRecords = sequenceDisplayRows().map((row) => ({ ...row }));
  }

  function sequenceDisplayRows() {
    const startOrder = state.ringSequence.startOrder;
    return Array.from({ length: startOrder }, (_, index) => ({
      index: index + 1,
      order: startOrder - index,
      confidence: 1,
      radiusPx: 0
    }));
  }

  function restoreRingSummaryFromSession() {
    state.ringSequence = normalizedRingSequence(
      state.session.ringSequence || state.ringSequence
    );
    state.ringSummary.rows = sequenceDisplayRows();
    state.ringSummary.activeIndex = null;
    state.ringSummary.pendingIndex = null;
    state.ringSummary.status = "idle";
    state.vision.detectedRings = [];
    state.vision.ringRadii = [];
    state.vision.lockUntil = 0;
    state.currentRingOrder = state.ringSequence.currentOrder;
    state.vision.ringOrder = state.ringSequence.currentOrder;
    state.ringSummary.status = state.ringSequence.completed ? "ready" : "idle";
    persistRingSequence();
  }

  function resetRingSequence({ announce = false } = {}) {
    const startOrder = clamp(
      Math.round(numberOr(settings.ringBase, 1)),
      1,
      RING_MAX_DETECTED
    );
    state.ringSequence = normalizedRingSequence({ startOrder });
    state.ringSummary.rows = sequenceDisplayRows();
    state.ringSummary.activeIndex = null;
    state.ringSummary.pendingIndex = null;
    state.ringSummary.status = "idle";
    state.currentRingOrder = startOrder;
    state.vision.ringOrder = startOrder;
    state.vision.lastAutoRecordAt = 0;
    persistRingSequence();
    renderRingSummary();
    updateVisionUI();
    if (announce) {
      addEvent("reset", "暗环顺序计数已开始", `左侧首环 m=${startOrder} → m=1 → 中央暗斑 → 右侧 m=1 → m=${startOrder}`);
      toast("顺序计数已开始", `左侧首环设为 m=${startOrder}，向右移动并跨过中央暗斑后继续记录右侧。`);
    }
  }

  function renderRingSummary() {
    const body = $("ringSummaryBody");
    if (!body) return;
    const sequence = state.ringSequence;
    const rows = sequenceDisplayRows();
    state.ringSummary.rows = rows;
    state.ringSummary.activeIndex = rows.find((row) => row.order === sequence.currentOrder)?.index ?? null;
    const pairsByOrder = new Map(
      state.session.pairs.map((pair) => [Number(pair.order), pair])
    );
    const pairedCount = rows.filter((row) => {
      const pair = pairsByOrder.get(Number(row.order));
      return Boolean(pair?.left && pair?.right);
    }).length;
    const recordedCrossings = sequence.rightCount + sequence.leftCount;
    const totalCrossings = sequence.startOrder * 2;
    $("ringDetectedCount").textContent = String(recordedCrossings);
    $("ringRecordedCount").textContent = String(pairedCount);
    $("ringActiveOrder").textContent = sequence.completed ? "OK" : String(sequence.currentOrder);
    $("ringDetectionBadge").textContent = `${recordedCrossings} / ${totalCrossings} 次记录`;
    const allPaired = sequence.completed && pairedCount === rows.length;
    $("ringDetectionBadge").classList.toggle("live", allPaired);
    $("ringDetectionBadge").classList.toggle("amber", !allPaired);

    body.innerHTML = rows.map((row) => {
      const isActive = !sequence.completed
        && row.order === sequence.currentOrder
        && row.index === state.ringSummary.activeIndex;
      const pair = pairsByOrder.get(Number(row.order));
      const left = pair?.left;
      const right = pair?.right;
      const complete = Boolean(left && right);
      const leftReading = left ? Number(left.positionMm).toFixed(3) : "--";
      const rightReading = right ? Number(right.positionMm).toFixed(3) : "--";
      const stateText = complete
        ? "完成"
        : right
          ? "右测"
          : left
            ? "左测"
            : isActive ? "当前" : "待测";
      const stateClass = complete
        ? "complete"
        : right || left
          ? "partial"
          : isActive ? "active" : "";
      return `
        <tr class="${isActive && !complete ? "active" : ""} ${left || right ? "recorded" : ""}" data-ring-index="${row.index}">
          <td class="ring-order-cell">
            <div class="ring-order-main">
              <strong>m = ${row.order}</strong>
              <span class="ring-row-status ${stateClass}">${stateText}</span>
            </div>
            <small>${complete ? `D ${Number(pair.diameterMm).toFixed(3)} mm` : "灰度谷值穿越记录"}</small>
          </td>
          <td class="ring-side-reading left ${left ? "recorded" : isActive && sequence.phase === "left" ? "live" : "pending"}">${leftReading}</td>
          <td class="ring-side-reading right ${right ? "recorded" : isActive && sequence.phase === "right" ? "live" : "pending"}">${rightReading}</td>
          <td class="ring-action-cell">
            <button class="icon-button small ring-delete-button" type="button" data-delete-ring="${row.order}" title="删除 m=${row.order} 的环级测点" aria-label="删除 m=${row.order} 的环级测点">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          </td>
        </tr>
      `;
    }).join("");
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
  }

  function recordSequencePoint(options = {}) {
    const sequence = state.ringSequence;
    if (sequence.completed || state.session.status !== "active") return null;
    if (state.encoder.mode === "connecting") return null;
    const side = sequence.phase === "left" ? "left" : "right";
    const order = sequence.currentOrder;
    const existingPair = state.session.pairs.find((pair) => Number(pair.order) === order);
    if (existingPair?.[side]) return null;
    const recorded = captureMeasurement(side, {
      order,
      automatic: options.automatic !== false,
      silent: !options.notify,
      imagePoint: {
        calibrationXPx: calibrationXPx(),
        valleyXPx: Number.isFinite(Number(options.valleyXPx))
          ? Number(options.valleyXPx)
          : null,
        crossingDirection: numberOr(options.crossingDirection, 0)
      }
    });
    if (!recorded) return null;

    sequence.lastCrossingAt = new Date().toISOString();
    if (Number.isFinite(Number(options.crossingDirection)) && Number(options.crossingDirection) !== 0) {
      sequence.crossingDirection = Math.sign(Number(options.crossingDirection));
    }
    if (side === "left") {
      sequence.leftCount += 1;
      if (order > 1) {
        sequence.currentOrder = order - 1;
      } else {
        sequence.phase = "right";
        sequence.currentOrder = 1;
      }
    } else {
      sequence.rightCount += 1;
      if (order < sequence.startOrder) {
        sequence.currentOrder = order + 1;
      } else {
        sequence.completed = true;
      }
    }
    state.currentRingOrder = sequence.currentOrder;
    state.vision.ringOrder = sequence.currentOrder;
    state.vision.lastAutoRecordAt = Date.now();
    state.ringSummary.status = sequence.completed ? "ready" : "active";
    persistRingSequence();
    renderRingSummary();
    updateVisionUI();
    if (options.notify) {
      toast(
        sequence.completed ? "左右两侧顺序记录完成" : "暗环穿越已记录",
        `m=${order} ${side === "left" ? "左侧" : "右侧"} · ${Number(recorded.readingMm).toFixed(3)} mm`
      );
    }
    return recorded;
  }

  function clearRingSummary() {
    if (!window.confirm("清空所有暗环级测点？左右坐标、配对数据和对应快照都会删除。")) return;
    state.session.pairs = [];
    state.session.captures = [];
    state.session.ringRecords = [];
    state.session.studentReadings = [];
    state.ringSummary.status = "idle";
    state.vision.lockUntil = 0;
    resetRingSequence();
    addEvent("reset", "暗环测点已清空", `将从左侧 m=${settings.ringBase} 重新开始记录`);
    renderAll();
    persistSession(true);
    toast("暗环测点已清空", "左右坐标、配对结果和对应快照已删除。", "warn");
  }

  function deleteRingRecord(order) {
    const targetOrder = clamp(Math.round(numberOr(order, 0)), 1, RING_MAX_DETECTED);
    const existingPair = state.session.pairs.find((pair) => Number(pair.order) === targetOrder);
    const captureCount = state.session.captures.filter((capture) => Number(capture.order) === targetOrder).length;
    if (!existingPair && !captureCount) {
      toast("该环级没有可删除数据", `m=${targetOrder} 尚未记录左右测点。`, "warn");
      return;
    }

    state.session.pairs = state.session.pairs.filter((pair) => Number(pair.order) !== targetOrder);
    state.session.captures = state.session.captures.filter((capture) => Number(capture.order) !== targetOrder);
    state.session.ringRecords = state.session.ringRecords.filter((record) => Number(record.order) !== targetOrder);
    state.session.studentReadings = state.session.studentReadings.filter(
      (reading) => Number(reading.order) !== targetOrder
    );

    const sequence = state.ringSequence;
    sequence.rightCount = state.session.pairs.filter((pair) => pair.right).length;
    sequence.leftCount = state.session.pairs.filter((pair) => pair.left).length;
    sequence.currentOrder = targetOrder;
    if (sequence.leftCount < sequence.startOrder) {
      sequence.phase = "left";
    } else {
      sequence.phase = "right";
    }
    sequence.completed = false;
    sequence.lastCrossingAt = null;
    sequence.tracks.clear();
    state.currentRingOrder = targetOrder;
    state.vision.ringOrder = targetOrder;
    state.vision.lockUntil = 0;
    state.ringSummary.status = "active";

    persistRingSequence();
    addEvent("reset", `已删除 m=${targetOrder} 的环级测点`, `移除 ${captureCount} 个测点与对应配对`);
    renderAll();
    persistSession(true);
    toast("环级测点已删除", `m=${targetOrder} 将从该级重新记录。`);
  }

  function updateSessionHeader() {
    $("studentNameLabel").textContent = state.session.student || "待填写实验者";
    $("groupLabel").textContent = state.session.group || "未分配组别";
    $("sessionCode").textContent = state.session.code;
    $("sessionTimer").textContent = formatDuration(state.session.elapsedMs);
    $("sessionPauseBtn").classList.toggle("paused", state.session.status === "paused");
    $("lambdaLabel").textContent = `${state.session.wavelengthNm.toFixed(1)} nm`;
    $("referenceRLabel").textContent = `${state.session.referenceR.toFixed(3)} m`;
    $("pitchLabel").textContent = `${settings.pitchMm.toFixed(3)} mm/rev`;
    $("runtimeModeLabel").textContent = state.session.demo ? "演示会话" : "实采会话";
    const pairCount = sortedPairs().length;
    $("pairCount").textContent = String(pairCount);
    $("pairProgress").style.width = `${clamp(pairCount / 10 * 100, 0, 100)}%`;
  }

  function updateSessionMeta() {
    $("metaSessionCode").textContent = state.session.code;
    $("metaStudent").textContent = state.session.student || "--";
    $("metaGroup").textContent = state.session.group || "--";
    $("metaLens").textContent = state.session.lens || "--";
    $("metaStartedAt").textContent = formatDateTime(state.session.startedAt);
    $("metaVersion").textContent = state.session.version || "fusion-1.0";
  }

  function updateOpticsUi() {
    updateVisionUI();
    const demoVideo = state.camera.demoVideo;
    const demoReady = !state.camera.active
      && state.camera.demoVideoReady
      && demoVideo?.readyState >= 2;
    const demoSize = demoReady && demoVideo.videoWidth
      ? `${demoVideo.videoWidth} × ${demoVideo.videoHeight}`
      : "1280 × 720";
    $("stageTimestamp").textContent = formatClock(new Date(), true);
    $("stageFrameInfo").textContent = state.camera.active
      ? "LIVE · 1280 × 720"
      : demoReady ? `VIDEO · ${demoSize}` : "SIM · 1280 × 720";
    $("opticPanelTitle").textContent = state.camera.active
      ? "牛顿环实时画面"
      : "牛顿环演示视频";
    $("opticCanvas").setAttribute(
      "aria-label",
      state.camera.active ? "牛顿环目镜实时画面" : "牛顿环目镜演示视频"
    );
    $("feedModeBadge").textContent = state.camera.active
      ? "实时画面"
      : demoReady ? "演示视频" : "模拟画面";
    $("feedModeBadge").classList.toggle("live", true);
    $("freezeBadge").textContent = state.camera.frameFrozen ? "FROZEN" : "30 FPS";
    $("cameraStatusText").textContent = state.camera.active
      ? "目镜摄像头在线"
      : demoReady ? "演示视频" : "模拟视野";
    setStatusChip(
      "camera",
      state.camera.active ? "online" : "demo",
      state.camera.active ? "目镜摄像头在线" : demoReady ? "演示视频" : "模拟视野"
    );
    $("freezeBtn").innerHTML = `<i data-lucide="${state.camera.frameFrozen ? "play" : "pause"}" aria-hidden="true"></i><span>${state.camera.frameFrozen ? "恢复" : "冻结"}</span>`;
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
  }

  function renderCaptureSlots() {
    const pair = currentPair();
    const left = pair?.left;
    const right = pair?.right;
    renderCaptureSlot("leftSlot", "leftSlotValue", "leftSlotTime", left);
    renderCaptureSlot("rightSlot", "rightSlotValue", "rightSlotTime", right);
    if (pair) {
      $("fusionStatus").textContent = "已配对";
      $("fusionStatus").className = "mini-badge live";
      $("diameterResult").textContent = `${pair.diameterMm.toFixed(3)} mm`;
      $("diameterSquaredResult").textContent = `${pair.diameterSquared.toFixed(3)} mm²`;
      $("pairedOrderResult").textContent = `m = ${pair.order}`;
    } else if (left || right) {
      $("fusionStatus").textContent = left ? "等待右测点" : "等待左测点";
      $("fusionStatus").className = "mini-badge amber";
      $("diameterResult").textContent = "--";
      $("diameterSquaredResult").textContent = "--";
      $("pairedOrderResult").textContent = `m = ${state.currentRingOrder}`;
    } else {
      $("fusionStatus").textContent = "等待测点";
      $("fusionStatus").className = "mini-badge";
      $("diameterResult").textContent = "--";
      $("diameterSquaredResult").textContent = "--";
      $("pairedOrderResult").textContent = "--";
    }
  }

  function renderCaptureSlot(slotId, valueId, timeId, measurement) {
    const slot = $(slotId);
    if (measurement) {
      slot.classList.add("recorded");
      slot.classList.remove("waiting");
      $(valueId).textContent = `${numberOr(measurement.positionMm, 0).toFixed(3)} mm`;
      const sourceLabel = measurement.source === "automatic"
        ? "AUTO"
        : measurement.source === "hardware"
          ? "HW"
          : "";
      $(timeId).textContent = `${formatClock(measurement.capturedAt)} · C ${(numberOr(measurement.confidence, 0) * 100).toFixed(0)}%${sourceLabel ? ` · ${sourceLabel}` : ""}`;
    } else {
      slot.classList.remove("recorded");
      slot.classList.add("waiting");
      $(valueId).textContent = "未记录";
      $(timeId).textContent = "等待捕获";
    }
  }

  function renderActivity() {
    const list = $("activityList");
    const events = [...state.session.events].slice(-7).reverse();
    list.innerHTML = events.map((event) => `
      <li class="${event.severity === "warn" ? "warn" : ""}">
        <time>${escapeHtml(formatClock(event.at))}</time>
        <strong>${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(event.detail)}</span>
      </li>
    `).join("");
  }

  function renderFullTimeline() {
    const list = $("fullTimeline");
    $("eventCountBadge").textContent = `${state.session.events.length} EVENTS`;
    const events = [...state.session.events].slice().reverse();
    list.innerHTML = events.map((event) => {
      const icon = EVENT_ICONS[event.type] || "circle-dot";
      return `
        <li>
          <span class="timeline-time">${escapeHtml(formatClock(event.at))}<br>${escapeHtml(formatDate(event.at))}</span>
          <span class="timeline-marker"><i data-lucide="${icon}" aria-hidden="true"></i></span>
          <div class="timeline-content">
            <strong>${escapeHtml(event.title)}</strong>
            <p>${escapeHtml(event.detail)}</p>
            <code>${escapeHtml(event.type.toUpperCase())} · ${escapeHtml(event.id.slice(-8))}</code>
          </div>
        </li>
      `;
    }).join("");
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
  }

  function renderSnapshots() {
    const grid = $("snapshotGrid");
    const captures = [...state.session.captures]
      .filter((capture) => capture.snapshot)
      .slice(-6)
      .reverse();
    if (!captures.length) {
      grid.innerHTML = `<div class="snapshot-empty">记录测点后将在此保存绑定帧</div>`;
      return;
    }
    grid.innerHTML = captures.map((capture) => `
      <div class="snapshot-card">
        <img src="${capture.snapshot}" alt="环级 m=${escapeHtml(capture.order)} ${capture.side === "left" ? "左侧" : "右侧"}测点快照">
        <span>m=${escapeHtml(capture.order)} · ${capture.side === "left" ? "L" : "R"}</span>
      </div>
    `).join("");
  }

  function renderPairTable(fit = computeFit()) {
    const body = $("pairTableBody");
    const pairs = sortedPairs();
    $("tableCountBadge").textContent = `${pairs.length} PAIRS`;
    $("pairTableEmpty").classList.toggle("hidden", pairs.length > 0);
    if (!pairs.length) {
      body.innerHTML = "";
      return;
    }
    const fitMap = new Map();
    if (fit) {
      fit.pairs.forEach((pair, index) => {
        fitMap.set(Number(pair.order), {
          fitted: fit.fitted[index],
          residual: fit.residuals[index],
          sigma: fit.residualSigma[index]
        });
      });
    }
    body.innerHTML = pairs.map((pair) => {
      const stats = fitMap.get(Number(pair.order));
      const residualClass = stats && Math.abs(stats.sigma) > numberOr(state.session.residualThreshold, 2.5) ? "warn" : "good";
      return `
        <tr>
          <td>${pair.order}</td>
          <td>${numberOr(pair.left?.positionMm, 0).toFixed(3)}</td>
          <td>${numberOr(pair.right?.positionMm, 0).toFixed(3)}</td>
          <td>${numberOr(pair.diameterMm, 0).toFixed(3)}</td>
          <td>${numberOr(pair.diameterSquared, 0).toFixed(3)}</td>
          <td>${stats ? stats.fitted.toFixed(3) : "--"}</td>
          <td class="${residualClass}">${stats ? signed(stats.residual, 3) : "--"}</td>
          <td>${(numberOr(pair.confidence, 0) * 100).toFixed(1)}%</td>
        </tr>
      `;
    }).join("");
  }

  function renderStudentComparisonTable() {
    const body = $("studentCompareBody");
    if (!body) return;
    const rows = studentComparisonRows();
    updateStudentComparisonBadge(rows);
    body.innerHTML = rows.map((row) => `
      <tr data-student-order="${row.order}">
        <td class="student-order">m = ${row.order}</td>
        <td class="student-input-cell">
          <input class="student-reading-input" type="number" step="0.001" inputmode="decimal"
            data-student-order="${row.order}" data-student-side="left"
            value="${Number.isFinite(row.studentLeft) ? row.studentLeft.toFixed(3) : ""}"
            placeholder="左读数">
        </td>
        <td class="student-input-cell">
          <input class="student-reading-input" type="number" step="0.001" inputmode="decimal"
            data-student-order="${row.order}" data-student-side="right"
            value="${Number.isFinite(row.studentRight) ? row.studentRight.toFixed(3) : ""}"
            placeholder="右读数">
        </td>
        <td>${studentComparisonValue(row.platformLeft)}</td>
        <td>${studentComparisonValue(row.platformRight)}</td>
        ${studentComparisonDiff(row.leftDiff)}
        ${studentComparisonDiff(row.rightDiff)}
        <td>${studentComparisonValue(row.studentDiameter)}</td>
        <td>${studentComparisonValue(row.platformDiameter)}</td>
        ${studentComparisonDiff(row.diameterDiff)}
      </tr>
    `).join("");
  }

  function renderAnalysis() {
    const fit = computeFit();
    $("fitChartEmpty").classList.toggle("hidden", Boolean(fit));
    if (!fit) {
      $("fitRMetric").textContent = "--";
      $("fitRUnit").textContent = "m";
      $("fitErrorMetric").textContent = "--";
      $("fitErrorNote").textContent = "等待拟合";
      $("fitR2Metric").textContent = "--";
      $("fitNMetric").textContent = String(sortedPairs().length);
      $("fitEquation").textContent = "等待有效配对数据";
      $("slopeStat").textContent = "--";
      $("interceptStat").textContent = "--";
      $("residualStdStat").textContent = "--";
      $("fitUncertaintyStat").textContent = "--";
      renderPairTable(null);
      drawFitChart(null);
      renderEvidence(null);
      return;
    }

    $("fitRMetric").textContent = fit.rMeters.toFixed(3);
    $("fitRUnit").textContent = "m";
    $("fitErrorMetric").textContent = `${fit.relativeError >= 0 ? "+" : ""}${fit.relativeError.toFixed(2)}%`;
    $("fitErrorNote").textContent = `参考 ${fit.referenceR.toFixed(3)} m`;
    $("fitR2Metric").textContent = fit.r2.toFixed(5);
    $("fitR2Note").textContent = fit.throughOrigin ? "过原点拟合" : "含截距线性拟合";
    $("fitNMetric").textContent = String(fit.pairs.length);
    $("fitNNote").textContent = "组左右配对";
    $("fitEquation").textContent = `${fit.equation}    R = a / (4λ) = ${fit.rMeters.toFixed(5)} m`;
    $("slopeStat").textContent = `${fit.slope.toFixed(6)} mm²/m`;
    $("interceptStat").textContent = `${fit.intercept.toFixed(6)} mm²`;
    $("residualStdStat").textContent = `${fit.residualStd.toFixed(6)} mm²`;
    $("fitUncertaintyStat").textContent = `${fit.uncertaintyR.toFixed(3)} m`;
    renderPairTable(fit);
    drawFitChart(fit);
    renderEvidence(fit);
  }

  function renderEvidence(fit) {
    const list = $("evidenceList");
    if (!fit) {
      list.innerHTML = `
        <div class="evidence-item"><i><span data-lucide="minus" aria-hidden="true"></span></i><div><strong>尚无拟合证据</strong><p>完成配对后自动生成残差、线性与不确定度证据。</p></div></div>
      `;
      window.lucide?.createIcons({ attrs: { "stroke-width": 1.7 } });
      return;
    }
    const diagnostics = generateDiagnostics();
    list.innerHTML = diagnostics.findings.slice(0, 6).map((finding) => `
      <div class="evidence-item ${finding.severity}">
        <i><span data-lucide="${finding.severity === "good" ? "check" : finding.severity === "warn" ? "alert-circle" : "x"}" aria-hidden="true"></span></i>
        <div>
          <strong>${escapeHtml(finding.title)}</strong>
          <p>${escapeHtml(finding.detail)}</p>
        </div>
      </div>
    `).join("");
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.7 } });
  }

  function renderQuickDiagnosis() {
    const diagnostics = generateDiagnostics();
    if (!diagnostics.fit) {
      $("quickDiagnosisTitle").textContent = "等待实验数据";
      $("quickDiagnosisText").textContent = "完成左右测点配对后，将自动检查线性、残差、联动延迟与环级置信度。";
      return;
    }
    $("quickDiagnosisTitle").textContent = diagnostics.score >= 88
      ? "数据链路稳定"
      : diagnostics.score >= 72
        ? "结果可用，建议复核"
        : "检测到明显异常";
    $("quickDiagnosisText").textContent = `${diagnostics.summary} 当前 R = ${diagnostics.fit.rMeters.toFixed(3)} m，R² = ${diagnostics.fit.r2.toFixed(3)}。`;
  }

  function renderReport() {
    const diagnostics = generateDiagnostics();
    const fit = diagnostics.fit;
    const pairs = sortedPairs();
    const studentRows = studentComparisonRows().filter((row) =>
      Number.isFinite(row.studentLeft) || Number.isFinite(row.studentRight)
    );
    const comparison = diagnostics.comparison;
    const studentRawSummary = summarizeStudentComparison();
    $("reportId").textContent = state.session.code.replace("NR-", "RPT-");
    $("reportStudent").textContent = state.session.student || "未填写";
    $("reportGroup").textContent = state.session.group || "未分组";
    $("reportDate").textContent = formatDate(state.session.startedAt);
    $("reportDevice").textContent = state.session.deviceId || "NR-FUSION-01";

    if (!fit) {
      $("reportSummary").textContent = "当前尚未形成至少两组同环级的左右配对数据，无法可靠估计平凸透镜曲率半径。建议先完成 8–10 个连续暗环的左右测点，并确认编码器换算与视觉判读处于正常状态。";
      $("reportR").textContent = "--";
      $("reportError").textContent = "--";
      $("reportR2").textContent = "--";
      $("reportN").textContent = String(pairs.length);
      $("reportFormula").textContent = "等待有效拟合数据。";
    } else {
      const ringPairs = fit.pairs.filter((pair) => Number(pair.order) > 0);
      $("reportSummary").textContent = `本次实验共形成 ${ringPairs.length} 组暗环左右配对，覆盖第 ${ringPairs[0].order}–${ringPairs.at(-1).order} 级暗环${fit.pairs.some((pair) => Number(pair.order) === 0) ? "，并包含中央 m=0 对照" : ""}。按 D² = a·m + b 进行${fit.throughOrigin ? "过原点" : "含截距"}最小二乘拟合，得到曲率半径 R = ${fit.rMeters.toFixed(3)} m，相对参考值偏差 ${signed(fit.relativeError, 2)}%，拟合优度 R² = ${fit.r2.toFixed(3)}。${diagnostics.summary}${comparison ? ` 学生采用${comparison.method}得到 ${comparison.studentR.toFixed(3)} m，与平台结果相差 ${signed(comparison.differencePercent, 2)}%。` : ""}`;
      $("reportR").textContent = `${fit.rMeters.toFixed(3)} m`;
      $("reportError").textContent = `${fit.relativeError >= 0 ? "+" : ""}${fit.relativeError.toFixed(2)}%`;
      $("reportR2").textContent = fit.r2.toFixed(5);
      $("reportN").textContent = String(ringPairs.length);
      $("reportFormula").textContent = `${fit.equation}；λ = ${fit.wavelengthNm.toFixed(1)} nm；R = a/(4λ) = ${fit.rMeters.toFixed(5)} m；回归斜率标准差 = ${fit.slopeStd.toFixed(7)} mm²/m。`;
    }

    if (document.activeElement !== $("studentResultInput")) {
      $("studentResultInput").value = state.session.studentResultR == null ? "" : String(state.session.studentResultR);
    }
    if (document.activeElement !== $("studentUncertaintyInput")) {
      $("studentUncertaintyInput").value = state.session.studentUncertaintyR == null ? "" : String(state.session.studentUncertaintyR);
    }
    $("studentMethodInput").value = state.session.studentMethod || "逐差法";

    $("reportAutoR").textContent = fit ? `${fit.rMeters.toFixed(3)} m` : "--";
    $("reportStudentR").textContent = comparison
      ? `${comparison.studentR.toFixed(3)} m · ${comparison.method}`
      : "--";
    $("reportCompareDiff").textContent = comparison
      ? `${signed(comparison.difference, 4)} m / ${signed(comparison.differencePercent, 2)}%`
      : "--";
    $("reportCompareState").textContent = comparison ? comparison.label : "--";
    const rawComparisonText = studentRawSummary
      ? `逐环对照已录入 ${studentRawSummary.count} 级；左右平均绝对差分别为 ${studentRawSummary.meanAbsLeftDiff.toFixed(3)} mm 和 ${studentRawSummary.meanAbsRightDiff.toFixed(3)} mm；最大 D 差值出现在 m=${studentRawSummary.largest.order}，为 ${signed(studentRawSummary.largest.diameterDiff, 3)} mm。`
      : "尚未录入完整的逐环学生左右读数。";
    $("reportCompareText").textContent = `${comparison
      ? `平台拟合结果为 ${fit.rMeters.toFixed(3)} m，学生采用${comparison.method}得到 ${comparison.studentR.toFixed(3)} m${comparison.studentUncertaintyR != null && Number.isFinite(comparison.studentUncertaintyR) ? `，报告不确定度 ${comparison.studentUncertaintyR.toFixed(3)} m` : ""}。两者绝对差值为 ${Math.abs(comparison.difference).toFixed(3)} m，相对差 ${Math.abs(comparison.differencePercent).toFixed(2)}%。`
      : "尚未录入学生手工核算结果。"} ${rawComparisonText}`;
    $("studentComparisonSideText").textContent = comparison
      ? `${comparison.label}：学生 ${comparison.studentR.toFixed(3)} m，与平台相差 ${signed(comparison.differencePercent, 2)}%。`
      : "录入学生结果后，平台会检查两种核算是否一致。";

    $("reportTableBody").innerHTML = pairs.slice(-12).map((pair) => {
      let residual = "--";
      if (fit) {
        const index = fit.pairs.findIndex((item) => Number(item.order) === Number(pair.order));
        if (index >= 0) residual = signed(fit.residuals[index], 4);
      }
      return `
        <tr>
          <td>${pair.order}</td>
          <td>${numberOr(pair.left?.positionMm, 0).toFixed(3)}</td>
          <td>${numberOr(pair.right?.positionMm, 0).toFixed(3)}</td>
          <td>${numberOr(pair.diameterMm, 0).toFixed(3)}</td>
          <td>${numberOr(pair.diameterSquared, 0).toFixed(3)}</td>
          <td>${residual}</td>
        </tr>
      `;
    }).join("");

    $("reportFindings").innerHTML = diagnostics.findings.map((finding) => `
      <div class="report-finding ${finding.severity}">
        <strong>${escapeHtml(finding.title)}</strong>
        <p>${escapeHtml(finding.detail)}</p>
      </div>
    `).join("");

    const captureCount = state.session.captures.length;
    const range = pairs.length ? `${pairs[0].order}–${pairs.at(-1).order}` : "--";
    $("reportQuality").innerHTML = `
      <div class="quality-cell"><span>有效配对</span><strong>${pairs.length} 组</strong></div>
      <div class="quality-cell"><span>覆盖级次</span><strong>${range}</strong></div>
      <div class="quality-cell"><span>原始测点</span><strong>${captureCount} 条</strong></div>
      <div class="quality-cell"><span>平均置信度</span><strong>${(diagnostics.averageConfidence * 100).toFixed(1)}%</strong></div>
      <div class="quality-cell"><span>编码器延迟</span><strong>${Math.round(diagnostics.encoderLatency)} ms</strong></div>
      <div class="quality-cell"><span>数据模式</span><strong>${state.session.demo ? "演示" : "实采"}</strong></div>
    `;

    $("reportRecommendations").innerHTML = diagnostics.recommendations
      .map((recommendation) => `<li>${escapeHtml(recommendation)}</li>`)
      .join("");

    $("qualityScore").textContent = String(diagnostics.score);
    $("scoreSummary").textContent = diagnostics.summary;
    const degrees = diagnostics.score / 100 * 360;
    $("scoreRing").style.background = `conic-gradient(var(--green) 0deg, var(--green) ${degrees}deg, var(--paper-deep) ${degrees}deg)`;
    $("findingCount").textContent = String(diagnostics.findings.length);
    $("sideFindings").innerHTML = diagnostics.findings.slice(0, 5).map((finding) => `
      <div class="side-finding ${finding.severity}">
        <span><i data-lucide="${finding.severity === "good" ? "circle-check" : finding.severity === "warn" ? "triangle-alert" : "circle-x"}" aria-hidden="true"></i>${finding.severity === "good" ? "通过" : finding.severity === "warn" ? "关注" : "异常"}</span>
        <strong>${escapeHtml(finding.title)}</strong>
        <p>${escapeHtml(finding.detail)}</p>
      </div>
    `).join("");
    $("reportGeneratedAt").textContent = `生成时间：${formatDateTime(new Date())}`;
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
  }

  function renderAll() {
    updateSessionHeader();
    updateSessionMeta();
    updateEncoderUI();
    updateVisionUI();
    renderRingSummary();
    renderCaptureSlots();
    renderActivity();
    renderFullTimeline();
    renderSnapshots();
    renderBackendArchive();
    renderStudentComparisonTable();
    renderAnalysis();
    renderQuickDiagnosis();
    renderReport();
  }

  function drawEncoderDial() {
    const canvas = $("encoderDial");
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = CANVAS_THEME.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#dce5e9";
    ctx.beginPath();
    ctx.arc(0, 0, radius - 12, 0, Math.PI * 2);
    ctx.stroke();

    const angle = state.encoder.angleDeg;
    ctx.strokeStyle = CANVAS_THEME.amber;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, radius + 1, -Math.PI / 2, -Math.PI / 2 + angle * Math.PI / 180);
    ctx.stroke();

    for (let index = 0; index < 72; index += 1) {
      const theta = (-90 + index * 5) * Math.PI / 180;
      const major = index % 6 === 0;
      const inner = radius - (major ? 14 : 8);
      const outer = radius - 2;
      ctx.strokeStyle = major ? CANVAS_THEME.blue : CANVAS_THEME.line;
      ctx.lineWidth = major ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(theta) * inner, Math.sin(theta) * inner);
      ctx.lineTo(Math.cos(theta) * outer, Math.sin(theta) * outer);
      ctx.stroke();
    }

    const needleAngle = (-90 + angle) * Math.PI / 180;
    ctx.strokeStyle = CANVAS_THEME.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(needleAngle) * (radius - 24), Math.sin(needleAngle) * (radius - 24));
    ctx.stroke();
    ctx.fillStyle = CANVAS_THEME.amber;
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMainScaleRuler() {
    const canvas = $("mainScaleRuler");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const left = 22;
    const right = width - 22;
    const scaleWidth = right - left;
    const baselineY = 54;
    const readingMm = clamp(
      state.encoder.positionMm,
      MEASUREMENT_MIN_MM,
      MEASUREMENT_MAX_MM
    );
    const indexX = left
      + (readingMm - MEASUREMENT_MIN_MM)
      / (MEASUREMENT_MAX_MM - MEASUREMENT_MIN_MM)
      * scaleWidth;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = CANVAS_THEME.surface;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = CANVAS_THEME.line;
    ctx.fillRect(left, baselineY - 7, scaleWidth, 4);
    ctx.fillStyle = CANVAS_THEME.surfaceMid;
    ctx.fillRect(left, baselineY - 4, scaleWidth, 14);

    ctx.font = "12px Cascadia Mono, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let index = MEASUREMENT_MIN_MM; index <= MEASUREMENT_MAX_MM; index += 1) {
      const x = left
        + (index - MEASUREMENT_MIN_MM)
        / (MEASUREMENT_MAX_MM - MEASUREMENT_MIN_MM)
        * scaleWidth;
      const major = index % 10 === 0;
      const mid = index % 5 === 0;
      const top = baselineY - (major ? 26 : mid ? 17 : 10);
      ctx.fillStyle = major ? CANVAS_THEME.ink : CANVAS_THEME.muted;
      ctx.fillRect(x - (major ? 1 : 0.5), top, major ? 2 : 1, baselineY - top);
      if (major) {
        ctx.fillStyle = CANVAS_THEME.inkSoft;
        ctx.fillText(String(index), x, 12);
      }
    }

    const indicator = $("mainScaleIndex");
    if (indicator) {
      indicator.style.left = `${indexX / width * 100}%`;
    }
  }

  function createNoisePattern(ctx) {
    if (state.camera.noisePattern) return state.camera.noisePattern;
    const noise = document.createElement("canvas");
    noise.width = 180;
    noise.height = 180;
    const nctx = noise.getContext("2d");
    const image = nctx.createImageData(noise.width, noise.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = 70 + Math.random() * 110;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = Math.random() * 17;
    }
    nctx.putImageData(image, 0, 0);
    state.camera.noisePattern = ctx.createPattern(noise, "repeat");
    return state.camera.noisePattern;
  }

  function drawSyntheticOptics(ctx, width, height, timestamp) {
    const phase = state.encoder.raw / state.encoder.countsPerRev * Math.PI * 2;
    const centerX = width * 0.5 + Math.sin(phase * 0.72) * width * 0.105;
    const centerY = height * 0.5 + Math.cos(phase * 0.53) * height * 0.025;
    const rings = [];

    const background = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.max(width, height) * 0.72
    );
    background.addColorStop(0, "#17191a");
    background.addColorStop(0.35, "#2d3031");
    background.addColorStop(0.7, "#141617");
    background.addColorStop(1, "#070808");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const ringScale = Math.min(width, height) * 0.054;
    const centralRadius = ringScale * 0.58;
    const centralSpot = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      centralRadius
    );
    centralSpot.addColorStop(0, "rgba(0, 3, 1, 0.98)");
    centralSpot.addColorStop(0.72, "rgba(1, 5, 3, 0.94)");
    centralSpot.addColorStop(1, "rgba(2, 7, 5, 0)");
    ctx.fillStyle = centralSpot;
    ctx.beginPath();
    ctx.arc(centerX, centerY, centralRadius, 0, Math.PI * 2);
    ctx.fill();

    for (let order = 1; order <= 60; order += 1) {
      const radius = Math.sqrt(order * 0.78 + 0.04) * ringScale + order * 0.55;
      if (radius > Math.hypot(width, height) * 0.56) break;
      rings.push({
        order: settings.ringBase + order - 1,
        radius
      });
      ctx.strokeStyle = `rgba(3, 9, 6, ${0.62 - order * 0.007})`;
      ctx.lineWidth = 2.1 + (order < 4 ? 1.3 : 0.15);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(171, 192, 181, ${Math.max(0.02, 0.08 - order * 0.002)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 2.1, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = createNoisePattern(ctx);
    ctx.globalAlpha = 0.42;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;

    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.2,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    state.vision.center = { x: centerX, y: centerY };
    state.vision.centralDarkSpot = {
      detected: true,
      radiusPx: centralRadius,
      boundaryRadiusPx: centralRadius,
      contrast: 120,
      simulated: true
    };
    state.vision.latencyMs = 172 + Math.sin(timestamp * 0.0017) * 24;
  }

  function drawDemoVideoFrame(ctx, width, height) {
    const video = state.camera.demoVideo;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return false;
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    ctx.drawImage(
      video,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
    if (!state.vision.lastAt) {
      state.vision.center = { x: width / 2, y: height / 2 };
    }
    return true;
  }

  function initializeDemoVideo() {
    const video = $("demoVideo");
    if (!video) return;
    state.camera.demoVideo = video;
    const markReady = () => {
      state.camera.demoVideoReady = true;
      state.vision.lastAt = null;
      updateOpticsUi();
      drawOptics(performance.now());
    };
    video.addEventListener("loadeddata", markReady);
    video.addEventListener("playing", markReady);
    video.addEventListener("error", () => {
      state.camera.demoVideoReady = false;
      console.warn("演示视频载入失败，继续使用内置模拟画面。", video.error);
      updateOpticsUi();
    });
    const playPromise = video.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        state.camera.demoVideoReady = video.readyState >= 2;
        updateOpticsUi();
      });
    }
  }

  function orientedCameraSource(video) {
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const rotation = [-90, 90, 180].includes(Number(settings.cameraRotationDeg))
      ? Number(settings.cameraRotationDeg)
      : 0;
    if (!rotation) {
      return { source: video, width, height };
    }
    let canvas = state.camera.rotationCanvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      state.camera.rotationCanvas = canvas;
    }
    const quarterTurn = Math.abs(rotation) === 90;
    canvas.width = quarterTurn ? height : width;
    canvas.height = quarterTurn ? width : height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (rotation === -90) {
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    } else if (rotation === 90) {
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
    }
    ctx.drawImage(video, 0, 0);
    ctx.restore();
    return { source: canvas, width: canvas.width, height: canvas.height };
  }

  function drawCameraCover(ctx, width, height) {
    const video = state.camera.video;
    if (!video || video.readyState < 2) return false;
    const oriented = orientedCameraSource(video);
    const scale = Math.max(width / oriented.width, height / oriented.height);
    const drawWidth = oriented.width * scale;
    const drawHeight = oriented.height * scale;
    ctx.drawImage(
      oriented.source,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
    return true;
  }

  function drawCameraFrame(ctx, width, height) {
    const video = state.camera.video;
    if (!video || video.readyState < 2) {
      drawSyntheticOptics(ctx, width, height, performance.now());
      return;
    }
    drawCameraCover(ctx, width, height);
    if (!state.vision.lastAt) {
      state.vision.center = { x: width / 2, y: height / 2 };
    }
  }

  function drawOptics(now = state.demoClockMs) {
    if (state.camera.frameFrozen && state.camera.lastVideoFrame) {
      return;
    }
    const canvas = $("opticCanvas");
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (state.camera.active) {
      drawCameraFrame(ctx, width, height);
    } else if (!drawDemoVideoFrame(ctx, width, height)) {
      drawSyntheticOptics(ctx, width, height, now);
    }

    if (state.overlayEnabled) {
      drawOpticalOverlay(ctx, width, height);
    }

  }

  function drawOpticalOverlayLegacy(ctx, width, height) {
    const centerX = state.vision.center?.x ?? width / 2;
    const centerY = state.vision.center?.y ?? height / 2;
    const crossX = width / 2;
    const crossY = height / 2;
    const crossRadius = Math.hypot(crossX - centerX, crossY - centerY);
    const detectedRings = state.vision.detectedRings?.length
      ? state.vision.detectedRings
      : [];
    const visibleRings = detectedRings.length
      ? detectedRings
      : (state.vision.ringRadii || []);
    const nearest = visibleRings.reduce((best, ring) => {
      if (!best) return ring;
      return Math.abs(ring.radius - crossRadius) < Math.abs(best.radius - crossRadius) ? ring : best;
    }, null);

    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
    ctx.lineWidth = 1.15;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(crossX, 0);
    ctx.lineTo(crossX, height);
    ctx.moveTo(0, crossY);
    ctx.lineTo(width, crossY);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    ctx.beginPath();
    ctx.arc(crossX, crossY, 27, 0, Math.PI * 2);
    ctx.stroke();

    const centralSpot = state.vision.centralDarkSpot;
    if (centralSpot?.detected) {
      const centralRadius = Math.max(
        5,
        numberOr(centralSpot.boundaryRadiusPx, numberOr(centralSpot.radiusPx, 0))
      );
      ctx.strokeStyle = "rgba(215, 157, 84, 0.94)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(centerX, centerY, centralRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.font = "9px Microsoft YaHei UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("中央暗斑", centerX + centralRadius + 5, centerY);
    }

    if (detectedRings.length) {
      detectedRings.forEach((ring) => {
        const isActive = ring === nearest;
        ctx.strokeStyle = isActive
          ? "rgba(215, 157, 84, 0.98)"
          : "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = isActive ? 2.2 : 1.15;
        ctx.setLineDash(isActive ? [7, 5] : [4, 6]);
        ctx.beginPath();
        ctx.arc(centerX, centerY, Math.max(4, ring.radius), 0, Math.PI * 2);
        ctx.stroke();

        const labelAngle = -0.62;
        const labelX = centerX + Math.cos(labelAngle) * ring.radius;
        const labelY = centerY + Math.sin(labelAngle) * ring.radius;
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(27, 27, 27, 0.82)";
        ctx.fillRect(labelX - 13, labelY - 8, 28, 15);
        ctx.fillStyle = isActive ? CANVAS_THEME.amber : CANVAS_THEME.surface;
        ctx.font = "9px Cascadia Mono, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`m${ring.order}`, labelX, labelY);
      });
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "rgba(215, 157, 84, 0.96)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.max(4, crossRadius), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 11, 0, Math.PI * 2);
    ctx.stroke();

    if (nearest) {
      ctx.fillStyle = "rgba(27, 27, 27, 0.76)";
      ctx.fillRect(crossX + 15, crossY + 22, 110, 38);
      ctx.fillStyle = "rgba(236, 244, 239, 0.9)";
      ctx.font = "11px Cascadia Mono, Consolas, monospace";
      ctx.fillText(`m = ${nearest.order}`, crossX + 23, crossY + 38);
      ctx.fillStyle = CANVAS_THEME.amber;
      ctx.fillText(`C ${(state.vision.confidence * 100).toFixed(1)}%`, crossX + 23, crossY + 52);
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    ctx.font = "9px Cascadia Mono, Consolas, monospace";
    ctx.fillText("READING CROSSHAIR", 18, height - 53);
    ctx.restore();
  }

  function drawOpticalOverlay(ctx, width, height) {
    const calibration = calibrationXPx();
    const centerY = height / 2;
    const bandHalfHeight = 8;
    const valleys = state.vision.grayCurve?.valleys || [];
    const tracks = Array.from(state.ringSequence.tracks.values());

    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.62)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(0, centerY - bandHalfHeight, width, bandHalfHeight * 2);

    ctx.strokeStyle = "rgba(215, 157, 84, 0.98)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(calibration, 0);
    ctx.lineTo(calibration, height);
    ctx.stroke();
    ctx.fillStyle = "rgba(215, 157, 84, 0.96)";
    ctx.fillRect(calibration - 31, 10, 62, 18);
    ctx.fillStyle = CANVAS_THEME.ink;
    ctx.font = "10px Microsoft YaHei UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("固定标定线", calibration, 19);

    tracks.forEach((track, trackIndex) => {
      const x = Number(track.xPx);
      if (!Number.isFinite(x)) return;
      const nearLine = Math.abs(x - calibration) <= Math.max(16, state.ringSequence.deadZonePx || 0);
      const y = centerY - 13;
      ctx.fillStyle = nearLine ? "rgba(215, 157, 84, 0.98)" : "rgba(247, 249, 250, 0.9)";
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x - 4, y + 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.closePath();
      ctx.fill();
      const order = Number(track.order);
      if (!Number.isFinite(order)) return;
      const lane = trackIndex % 4;
      const labelY = centerY - 44 - lane * 27;
      const labelWidth = 46;
      const labelHeight = 22;
      ctx.strokeStyle = "rgba(79, 120, 148, 0.76)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, centerY - 10);
      ctx.lineTo(x, labelY + labelHeight);
      ctx.stroke();
      ctx.fillStyle = nearLine ? "rgba(215, 157, 84, 0.96)" : "rgba(27, 27, 27, 0.82)";
      ctx.fillRect(x - labelWidth / 2, labelY, labelWidth, labelHeight);
      ctx.fillStyle = nearLine ? CANVAS_THEME.ink : CANVAS_THEME.surface;
      ctx.font = "14px Microsoft YaHei UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`m=${order}`, x, labelY + labelHeight / 2 + 0.5);
    });

    valleys.forEach((valley) => {
      const x = Number(valley.xPx);
      if (!Number.isFinite(x)) return;
      ctx.fillStyle = "rgba(215, 157, 84, 0.78)";
      ctx.beginPath();
      ctx.arc(x, centerY + 13, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });

    const sequence = state.ringSequence;
    const label = sequence.completed
      ? "顺序记录完成"
      : `${sequence.phase === "right" ? "右侧" : "左侧"} m=${sequence.currentOrder}`;
    ctx.fillStyle = "rgba(27, 27, 27, 0.82)";
    ctx.fillRect(16, height - 42, 154, 26);
    ctx.fillStyle = CANVAS_THEME.surface;
    ctx.font = "11px Microsoft YaHei UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, 26, height - 29);
    ctx.restore();
  }

  function demoRawRange() {
    const zeroRaw = encoderRawForPosition(DEMO_TRAVEL_MIN_MM);
    const fullRaw = encoderRawForPosition(DEMO_TRAVEL_MAX_MM);
    return {
      min: Math.min(zeroRaw, fullRaw),
      max: Math.max(zeroRaw, fullRaw)
    };
  }

  function updateDemoEncoder(deltaMs) {
    if (
      state.encoder.mode !== "demo"
      || state.session.status === "paused"
      || !state.demoMotion
    ) return;
    if (performance.now() < state.encoder.demoPauseUntil) return;
    const { min: demoMin, max: demoMax } = demoRawRange();
    const sweepStep = (demoMax - demoMin) / DEMO_TRAVEL_DURATION_MS * deltaMs;
    state.encoder.lastDemoRaw += sweepStep * state.encoder.demoDirection;
    if (state.encoder.lastDemoRaw >= demoMax) {
      state.encoder.lastDemoRaw = demoMax;
      state.encoder.demoDirection = -1;
      state.encoder.demoPauseUntil = performance.now() + 550;
    } else if (state.encoder.lastDemoRaw <= demoMin) {
      state.encoder.lastDemoRaw = demoMin;
      state.encoder.demoDirection = 1;
      state.encoder.demoPauseUntil = performance.now() + 550;
    }
    state.encoder.raw = state.encoder.lastDemoRaw;
    state.encoder.countsPerRev = numberOr(settings.countsPerRev, 8192);
    state.encoder.pitchMm = numberOr(settings.pitchMm, 0.5);
    state.encoder.zeroOffsetMm = numberOr(settings.zeroOffsetMm, 0);
    state.encoder.direction = settings.direction === -1 ? -1 : 1;
    state.encoder.angleDeg = normalizeAngle(state.encoder.raw / state.encoder.countsPerRev * 360);
    state.encoder.previousPosition = state.encoder.positionMm;
    state.encoder.positionMm = encoderPosition(state.encoder.raw);
    state.encoder.relativeMm = state.encoder.positionMm - configuredStartPositionMm();
    state.encoder.latencyMs = 17 + Math.sin(performance.now() * 0.002) * 3;
    state.encoder.sampleRate = 50;
  }

  function demoVisualsPaused() {
    return state.encoder.mode === "demo"
      && (state.session.status === "paused" || !state.demoMotion);
  }

  function syncDemoVisuals() {
    const paused = demoVisualsPaused();
    state.liveModelViewer?.setAnimationPaused?.(paused);
    if (!state.camera.active && state.camera.demoVideo && !state.camera.frameFrozen) {
      if (paused) {
        state.camera.demoVideo.pause();
      } else {
        state.camera.demoVideo.play().catch(() => {});
      }
    }
  }

  function setDemoMotion(enabled, notify = false) {
    state.demoMotion = enabled;
    if (enabled) {
      state.demoPausedByUser = false;
      state.encoder.demoPauseUntil = 0;
      const { min, max } = demoRawRange();
      if (state.encoder.lastDemoRaw >= max) state.encoder.demoDirection = -1;
      else if (state.encoder.lastDemoRaw <= min) state.encoder.demoDirection = 1;
    }
    const button = $("liveDemoMotionBtn");
    if (button) {
      setButtonActive(button, enabled);
      button.innerHTML = `<i data-lucide="${enabled ? "pause" : "play"}" aria-hidden="true"></i><span>${enabled ? "暂停演示" : "继续演示"}</span>`;
      window.lucide?.createIcons({ attrs: { "stroke-width": 1.7 } });
    }
    syncDemoVisuals();
    if (notify) {
      toast(
        enabled ? "自动演示已继续" : "已切换为手动模拟",
        enabled ? "鼓轮与显微组件恢复自动往返。" : "拖动编码器角度盘可手动操作三维装置。"
      );
    }
  }

  function applyDemoRaw(raw) {
    const { min, max } = demoRawRange();
    raw = clamp(raw, min, max);
    state.encoder.lastDemoRaw = raw;
    state.encoder.raw = raw;
    state.encoder.countsPerRev = numberOr(settings.countsPerRev, 8192);
    state.encoder.pitchMm = numberOr(settings.pitchMm, 0.5);
    state.encoder.zeroOffsetMm = numberOr(settings.zeroOffsetMm, 0);
    state.encoder.direction = settings.direction === -1 ? -1 : 1;
    state.encoder.angleDeg = normalizeAngle(raw / state.encoder.countsPerRev * 360);
    state.encoder.previousPosition = state.encoder.positionMm;
    state.encoder.positionMm = encoderPosition(raw);
    state.encoder.relativeMm = state.encoder.positionMm - configuredStartPositionMm();
    updateEncoderUI();
  }

  function recordEncoderMonitor(timestamp, readingMm) {
    const monitor = state.encoderMonitor;
    if (monitor.paused || timestamp - monitor.lastSampleAt < 100) {
      return;
    }
    monitor.lastSampleAt = timestamp;
    const localDate = new Date();
    monitor.samples.push({
      seq: monitor.samples.length ? monitor.samples.at(-1).seq + 1 : 1,
      performanceAt: Number(timestamp.toFixed(3)),
      localTime: formatClock(localDate, true),
      isoTime: localDate.toISOString(),
      valueMm: Number(readingMm.toFixed(6)),
      raw: Math.round(state.encoder.raw),
      angleDeg: Number(state.encoder.angleDeg.toFixed(4)),
      latencyMs: Number(state.encoder.latencyMs.toFixed(1)),
      sampleRate: Number(state.encoder.sampleRate.toFixed(1))
    });
    if (monitor.samples.length > monitor.limit) {
      monitor.samples.splice(0, monitor.samples.length - monitor.limit);
    }
    if (
      state.view === "process"
      && timestamp - monitor.lastDrawAt >= 180
    ) {
      monitor.lastDrawAt = timestamp;
      renderProcessEncoderMonitor();
    }
  }

  function prepareEncoderHistoryCanvas(canvas) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return null;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(bounds.width * ratio);
    const height = Math.round(bounds.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: bounds.width, height: bounds.height };
  }

  function drawEncoderHistoryChart() {
    const canvas = $("encoderHistoryChart");
    const prepared = prepareEncoderHistoryCanvas(canvas);
    const empty = $("encoderHistoryEmpty");
    if (!prepared) {
      return;
    }
    const { context, width, height } = prepared;
    const samples = state.encoderMonitor.samples.slice(-300);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fbfcfb";
    context.fillRect(0, 0, width, height);

    if (!samples.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const padding = { left: 58, right: 16, top: 18, bottom: 31 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);
    const values = samples.map((sample) => sample.valueMm);
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    if (Math.abs(maximum - minimum) < 0.000001) {
      minimum -= 0.0005;
      maximum += 0.0005;
    }
    const rangePadding = (maximum - minimum) * 0.12;
    minimum -= rangePadding;
    maximum += rangePadding;
    const range = Math.max(0.000001, maximum - minimum);
    const xFor = (index) => (
      padding.left + (index / Math.max(1, samples.length - 1)) * plotWidth
    );
    const yFor = (value) => (
      padding.top + ((maximum - value) / range) * plotHeight
    );

    context.strokeStyle = "#dbe5df";
    context.lineWidth = 1;
    context.fillStyle = "#72847b";
    context.font = "9px Consolas, monospace";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let index = 0; index <= 5; index += 1) {
      const ratio = index / 5;
      const y = padding.top + ratio * plotHeight;
      const value = maximum - ratio * range;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.fillText(value.toFixed(3), padding.left - 7, y);
    }

    const fill = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    fill.addColorStop(0, "rgba(47, 127, 114, 0.22)");
    fill.addColorStop(1, "rgba(47, 127, 114, 0.02)");
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = xFor(index);
      const y = yFor(sample.valueMm);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(xFor(samples.length - 1), height - padding.bottom);
    context.lineTo(xFor(0), height - padding.bottom);
    context.closePath();
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    samples.forEach((sample, index) => {
      const x = xFor(index);
      const y = yFor(sample.valueMm);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = "#2f7f72";
    context.lineWidth = 1.8;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();

    const last = samples.at(-1);
    const lastX = xFor(samples.length - 1);
    const lastY = yFor(last.valueMm);
    context.fillStyle = "#1f6f61";
    context.beginPath();
    context.arc(lastX, lastY, 3.2, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#72847b";
    context.font = "9px Microsoft YaHei, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    [0, Math.floor((samples.length - 1) / 2), samples.length - 1].forEach((index) => {
      context.fillText(samples[index].localTime.slice(-8), xFor(index), height - 8);
    });
  }

  function renderProcessEncoderMonitor(force = false) {
    if (!force && state.view !== "process") {
      return;
    }
    const samples = state.encoderMonitor.samples;
    const latest = samples.at(-1);
    const values = samples.map((sample) => sample.valueMm);
    const minimum = values.length ? Math.min(...values) : null;
    const maximum = values.length ? Math.max(...values) : null;
    const recentTimes = samples.slice(-20)
      .map((sample) => sample.performanceAt)
      .filter(Number.isFinite);
    const intervals = recentTimes.slice(1)
      .map((time, index) => time - recentTimes[index])
      .filter((value) => Number.isFinite(value) && value > 0);
    $("encoderMonitorCurrent").textContent = latest ? latest.valueMm.toFixed(3) : "--";
    $("encoderMonitorRaw").textContent = latest ? latest.raw.toLocaleString("en-US") : "--";
    $("encoderMonitorAngle").textContent = latest ? latest.angleDeg.toFixed(2) : "--";
    $("encoderMonitorMin").textContent = minimum == null ? "--" : minimum.toFixed(3);
    $("encoderMonitorMax").textContent = maximum == null ? "--" : maximum.toFixed(3);
    $("encoderMonitorCount").textContent = String(samples.length);
    $("encoderMonitorInterval").textContent = intervals.length
      ? `${Math.round(intervals.reduce((total, value) => total + value, 0) / intervals.length)} ms`
      : "-- ms";
    $("encoderMonitorBadge").textContent = state.encoderMonitor.paused
      ? "PAUSED"
      : "LIVE SAMPLING";

    const body = $("encoderHistoryBody");
    const tableEmpty = $("encoderHistoryTableEmpty");
    const recent = samples.slice(-30).reverse();
    body.innerHTML = recent.map((sample) => `
      <tr>
        <td>${sample.seq}</td>
        <td>${escapeHtml(sample.localTime)}</td>
        <td>${sample.valueMm.toFixed(3)}</td>
        <td>${sample.raw.toLocaleString("en-US")}</td>
        <td>${sample.angleDeg.toFixed(2)}</td>
        <td>${sample.latencyMs.toFixed(0)}</td>
      </tr>
    `).join("");
    tableEmpty.hidden = recent.length > 0;
    drawEncoderHistoryChart();
  }

  function toggleEncoderMonitorPause() {
    state.encoderMonitor.paused = !state.encoderMonitor.paused;
    const button = $("pauseEncoderHistoryBtn");
    button.classList.toggle("is-active", state.encoderMonitor.paused);
    button.innerHTML = state.encoderMonitor.paused
      ? '<i data-lucide="play" aria-hidden="true"></i><span>继续采样</span>'
      : '<i data-lucide="pause" aria-hidden="true"></i><span>暂停采样</span>';
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.7 } });
    renderProcessEncoderMonitor(true);
  }

  function clearEncoderMonitor() {
    state.encoderMonitor.samples = [];
    state.encoderMonitor.lastSampleAt = 0;
    state.encoderMonitor.lastDrawAt = 0;
    $("encoderHistoryBody").innerHTML = "";
    $("encoderHistoryTableEmpty").hidden = false;
    renderProcessEncoderMonitor(true);
    toast("编码器曲线已清空", "过程档案中的实时采样记录已删除。");
  }

  function exportEncoderMonitorCsv() {
    const samples = state.encoderMonitor.samples;
    if (!samples.length) {
      toast("暂无可导出的编码器数据", "请等待实时采样后重试。", "warn");
      return;
    }
    const header = ["seq", "local_time", "iso_time", "value_mm", "raw_count", "angle_deg", "latency_ms", "sample_rate_hz"];
    const rows = samples.map((sample) => [
      sample.seq,
      sample.localTime,
      sample.isoTime,
      sample.valueMm.toFixed(6),
      sample.raw,
      sample.angleDeg.toFixed(4),
      sample.latencyMs.toFixed(1),
      sample.sampleRate.toFixed(1)
    ]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.join(",")).join("\r\n");
    downloadBlob(
      `${state.session.code}-encoder-history.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    toast("编码器 CSV 已导出", `${samples.length} 个实时采样点。`);
  }

  function exportEncoderMonitorSnapshot() {
    const samples = state.encoderMonitor.samples;
    if (!samples.length) {
      toast("暂无可导出的编码器快照", "请等待实时采样后重试。", "warn");
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      schema: "newton-ring-encoder-monitor",
      session: state.session.code,
      device: {
        mode: state.encoder.mode,
        countsPerRev: state.encoder.countsPerRev,
        pitchMm: state.encoder.pitchMm,
        direction: state.encoder.direction
      },
      samples
    };
    downloadBlob(
      `${state.session.code}-encoder-snapshot.json`,
      JSON.stringify(payload, null, 2)
    );
    toast("编码器快照已导出", `${samples.length} 个实时采样点。`);
  }

  function animationLoop(timestamp) {
    try {
      const deltaMs = Math.min(100, timestamp - state.lastTick);
      state.lastTick = timestamp;
      const previousRingOrder = state.currentRingOrder;
      const demoPaused = demoVisualsPaused();
      state.liveModelViewer?.setAnimationPaused?.(demoPaused);
      if (!demoPaused) {
        state.demoClockMs = timestamp;
        updateDemoEncoder(deltaMs);
        drawOptics(state.demoClockMs);
      }
      if (previousRingOrder !== state.currentRingOrder) {
        renderCaptureSlots();
      }
      const readingMm = clamp(
        state.encoder.positionMm,
        MEASUREMENT_MIN_MM,
        MEASUREMENT_MAX_MM
      );
      const stageAngleDeg = normalizeAngle(
        (readingMm - MEASUREMENT_MIN_MM)
        / Math.max(0.0001, state.encoder.pitchMm)
        * 360
      );
      state.liveModelViewer?.setReadout?.({
        angleDeg: stageAngleDeg,
        positionMm: readingMm,
        angleOffsetDeg: numberOr(settings.drumZeroAngle, 0)
      });
      let mainMm = Math.floor(readingMm + 1e-9);
      let drumTicks = (readingMm - mainMm) / Math.max(0.0001, state.encoder.pitchMm) * 100;
      if (drumTicks > 99.9995) {
        mainMm += 1;
        drumTicks = 0;
      }
      const drumDivisionMm = state.encoder.pitchMm / 100;
      const reconstructedMm = mainMm + drumTicks * drumDivisionMm;
      $("liveModelAngle").textContent = `${stageAngleDeg.toFixed(2)}°`;
      $("liveModelPosition").textContent = `${reconstructedMm.toFixed(3)} mm`;
      $("liveMainScaleTicks").textContent = String(mainMm);
      $("liveStageReading").textContent = reconstructedMm.toFixed(3);
      $("mainScaleHeadValue").textContent = `${reconstructedMm.toFixed(3)} / 50.000 mm`;
      drawMainScaleRuler();
      $("liveStageTick").textContent = drumTicks.toFixed(1);
      $("liveDrumDivision").textContent = drumDivisionMm.toFixed(3);
      const startReadingMm = configuredStartPositionMm();
      const relativeReadingMm = state.encoder.relativeMm;
      $("liveReadingFormula").textContent =
        `起始 ${startReadingMm.toFixed(3)} ${relativeReadingMm >= 0 ? "+" : "−"} ${Math.abs(relativeReadingMm).toFixed(3)} = ${reconstructedMm.toFixed(3)} mm`;
      drawEncoderDial();
      updateEncoderUI();
      recordEncoderMonitor(timestamp, readingMm);
      updateVisionUI();
      const currentSecond = Math.floor(timestamp / 1000);
      if (currentSecond !== state.lastClockSecond) {
        state.lastClockSecond = currentSecond;
        $("stageTimestamp").textContent = formatClock(new Date(), true);
      }
    } catch (error) {
      console.error("Demo animation frame failed:", error);
    } finally {
      requestAnimationFrame(animationLoop);
    }
  }

  function setCurrentRingOrder(order, options = {}) {
    state.currentRingOrder = clamp(Math.round(numberOr(order, 1)), 1, 80);
    state.vision.ringOrder = state.currentRingOrder;
    if (options.manual) {
      state.manualRingUntil = Date.now() + 5000;
    }
    renderCaptureSlots();
  }

  function setRingStartOrder(order, options = {}) {
    const startOrder = clamp(Math.round(numberOr(order, settings.ringBase)), 1, RING_MAX_DETECTED);
    settings.ringBase = startOrder;
    settings.settingsVersion = 8;
    saveJson(SETTINGS_KEY, settings);
    $("ringOrderInput").value = String(startOrder);
    $("ringBaseInput").value = String(startOrder);
    resetRingSequence();
    if (options.notify !== false) {
      toast("起始级数已更新", `左侧从 m=${startOrder} 开始递减到 m=1，跳过中央暗斑后记录右侧。`);
    }
    return startOrder;
  }

  function captureMeasurement(side, options = {}) {
    if (state.session.status === "paused") {
      toast("会话已暂停", "继续会话后才能记录测点。", "warn");
      return null;
    }
    if (!["left", "right"].includes(side)) return null;
    const order = clamp(
      Math.round(numberOr(options.order, state.currentRingOrder)),
      1,
      RING_MAX_DETECTED
    );
    let pair = state.session.pairs.find((item) => Number(item.order) === order);
    if (pair?.[side] && !options.replace) {
      if (!options.silent) {
        toast("该侧已经记录", `m=${order} 的${side === "left" ? "左" : "右"}侧不会重复覆盖。`, "warn");
      }
      return null;
    }
    const capturedAt = new Date().toISOString();
    const confidence = clamp(numberOr(state.vision.confidence, 0.85), 0, 1);
    const crossX = $("opticCanvas").width / 2;
    const crossY = $("opticCanvas").height / 2;
    const measurement = {
      id: uid("measure"),
      side,
      order,
      positionMm: Number(state.encoder.positionMm.toFixed(6)),
      raw: Math.round(state.encoder.raw),
      angleDeg: Number(state.encoder.angleDeg.toFixed(4)),
      confidence,
      capturedAt,
      latencyMs: Number(state.encoder.latencyMs.toFixed(1)),
      imagePoint: {
        crossX,
        crossY,
        calibrationXPx: Number(numberOr(options.imagePoint?.calibrationXPx, calibrationXPx()).toFixed(2)),
        valleyXPx: Number.isFinite(Number(options.imagePoint?.valleyXPx))
          ? Number(Number(options.imagePoint.valleyXPx).toFixed(2))
          : null,
        crossingDirection: numberOr(options.imagePoint?.crossingDirection, 0)
      },
      source: options.automatic ? "automatic" : options.hardware ? "hardware" : "manual",
      snapshot: createSnapshot(320, 180, `m=${order} ${side === "left" ? "左" : "右"}侧`)
    };
      const motion = state.measurementMotion;
      const capturedAtMs = Date.parse(capturedAt);
      const recentSortedLatencies = motion.recentLatencies
        .slice()
        .sort((left, right) => left - right);
      const medianRecentLatency = recentSortedLatencies.length
        ? recentSortedLatencies[Math.floor(recentSortedLatencies.length / 2)]
        : 18;
      measurement.latencySpike = Number.isFinite(measurement.latencyMs)
        && measurement.latencyMs > Math.max(180, medianRecentLatency * 3);
      const captureGapSeconds = Number.isFinite(motion.lastCaptureAt)
        ? (capturedAtMs - motion.lastCaptureAt) / 1000
        : null;
      const rawDelta = Number.isFinite(motion.lastRaw)
        ? measurement.raw - motion.lastRaw
        : 0;
      measurement.encoderJumpWarning = captureGapSeconds != null
        && captureGapSeconds > 0
        && captureGapSeconds < 2
        && Math.abs(rawDelta) > state.encoder.countsPerRev * 0.03;
      if (measurement.latencySpike) {
        addEvent(
          "warning",
          "记录到链路延迟尖峰",
          `m=${order} ${side === "left" ? "左" : "右"}侧延迟 ${Math.round(measurement.latencyMs)} ms`
        );
      }
      if (measurement.encoderJumpWarning) {
        addEvent(
          "warning",
          "记录到编码器计数跳变",
          `m=${order} 在 ${captureGapSeconds.toFixed(2)} s 内计数变化 ${Math.round(rawDelta)}`
        );
      }
      const motionDelta = motion.lastCapturePosition == null
        ? 0
        : measurement.positionMm - motion.lastCapturePosition;
      if (Math.abs(motionDelta) >= 0.003) {
        const nextDirection = Math.sign(motionDelta);
        const reversed = motion.direction !== 0 && nextDirection !== motion.direction;
        measurement.directionWarning = reversed;
        if (reversed) {
          addEvent(
            "capture",
            "检测到反向读数",
            `鼓轮由正向转为反向移动，本次读数可能包含空程误差 · ${measurement.positionMm.toFixed(3)} mm`
          );
        }
        motion.direction = nextDirection;
      }
      motion.lastCapturePosition = measurement.positionMm;
      motion.lastCaptureAt = capturedAtMs;
      motion.lastRaw = measurement.raw;
      motion.recentLatencies.push(numberOr(measurement.latencyMs, 18));
      motion.recentLatencies = motion.recentLatencies.slice(-20);

    if (!state.session.captures) state.session.captures = [];
    state.session.captures.push(measurement);
    if (state.session.captures.length > 120) {
      state.session.captures = state.session.captures.slice(-120);
    }

    if (!pair) {
      pair = {
        order,
        left: null,
        right: null,
        diameterMm: 0,
        diameterSquared: 0,
        confidence,
        createdAt: capturedAt
      };
      state.session.pairs.push(pair);
    }
    pair[side] = measurement;
    pair.confidence = mean([pair.left?.confidence, pair.right?.confidence].filter(Number.isFinite));
    if (pair.left && pair.right) {
      pair.diameterMm = Math.abs(pair.right.positionMm - pair.left.positionMm);
      pair.diameterSquared = pair.diameterMm ** 2;
      pair.createdAt = capturedAt;
    }

    addEvent(
      "capture",
      `${options.automatic ? "自动记录" : "记录"} m=${order} ${side === "left" ? "左" : "右"}侧测点`,
      `${measurement.positionMm.toFixed(3)} mm · raw ${measurement.raw} · 置信度 ${(confidence * 100).toFixed(1)}%`
    );

    if (pair.left && pair.right) {
      addEvent(
        "pair",
        `第 ${order} 级暗环完成配对`,
        `D = ${pair.diameterMm.toFixed(3)} mm · D² = ${pair.diameterSquared.toFixed(3)} mm²`
      );
    }

    renderAll();
    persistSession(true);
    if (!options.silent) {
      toast(
        measurement.directionWarning
          ? "检测到反向读数"
          : pair.left && pair.right
            ? "测量点已配对"
            : "测量点已记录",
        measurement.directionWarning
          ? `m=${order} 的读数可能受空程影响，建议保持单向移动后重新测量。`
          : `m=${order}，${side === "left" ? "左侧" : "右侧"}读数 ${measurement.positionMm.toFixed(3)} mm。`,
        measurement.directionWarning ? "warn" : undefined
      );
    }
    if (options.hardware) {
      addEvent("encoder", "硬件触发测点", `来自装置捕获信号 · ${side}`, { silent: false });
    }
    return {
      order,
      side,
      readingMm: measurement.positionMm,
      measurement,
      pair
    };
  }

  function createSnapshot(width = 320, height = 180, label = null) {
    const source = $("opticCanvas");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const cropRatio = clamp(numberOr(settings.cameraCropRatio, 0.3), 0.15, 0.8);
    const cropWidth = Math.max(1, source.width * cropRatio);
    const cropHeight = Math.max(1, source.height * cropRatio);
    const offsetX = numberOr(settings.cameraCropOffsetPx, -50) * source.width / 640;
    const sourceX = clamp(
      (source.width - cropWidth) / 2 + offsetX,
      0,
      Math.max(0, source.width - cropWidth)
    );
    const sourceY = Math.max(0, (source.height - cropHeight) / 2);
    ctx.drawImage(
      source,
      sourceX,
      sourceY,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height
    );
    ctx.fillStyle = "rgba(27,27,27,0.62)";
    ctx.fillRect(0, height - 22, width, 22);
    ctx.fillStyle = CANVAS_THEME.surface;
    ctx.font = "10px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`${label || `m=${state.currentRingOrder}`} · ${state.encoder.positionMm.toFixed(3)} mm`, 8, height - 7);
    return canvas.toDataURL("image/jpeg", 0.56);
  }

  function createVisionFrame() {
    if (!state.camera.active || !state.camera.video || state.camera.video.readyState < 2) {
      return $("opticCanvas").toDataURL("image/jpeg", 0.78);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    drawCameraCover(ctx, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  async function toggleCamera() {
    if (state.camera.active) {
      stopCamera();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("无法访问摄像头", "当前浏览器不支持媒体设备接口，请使用新版 Chrome 或 Edge。", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "environment"
        },
        audio: false
      });
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      state.camera.stream = stream;
      state.camera.video = video;
      state.camera.active = true;
      state.camera.frameFrozen = false;
      state.vision.lastAt = null;
      state.vision.center = { x: 640, y: 360 };
      state.vision.ringRadii = [];
      addEvent("camera", "目镜摄像头已连接", `${video.videoWidth || 1920} × ${video.videoHeight || 1080} · 实时画面`);
      updateOpticsUi();
      toast("摄像头已连接", "目镜画面已切换为实时输入。");
      if (numberOr(settings.visionInterval, 0) > 0) {
        startVisionInterval();
      }
    } catch (error) {
      console.error(error);
      toast("摄像头打开失败", "请检查浏览器权限或摄像头是否被其他程序占用。", "error");
    }
  }

  function stopCamera() {
    if (state.camera.stream) {
      state.camera.stream.getTracks().forEach((track) => track.stop());
    }
    state.camera.stream = null;
    state.camera.video = null;
    state.camera.active = false;
    state.camera.frameFrozen = false;
    state.vision.lastAt = null;
    clearVisionInterval();
    addEvent("camera", "目镜摄像头已断开", "画面回到内置模拟视野");
    updateOpticsUi();
  }

  function toggleFreeze() {
    state.camera.frameFrozen = !state.camera.frameFrozen;
    if (!state.camera.active && state.camera.demoVideo) {
      if (state.camera.frameFrozen) {
        state.camera.demoVideo.pause();
      } else {
        state.camera.demoVideo.play().catch(() => {});
      }
    }
    updateOpticsUi();
    addEvent("camera", state.camera.frameFrozen ? "画面已冻结" : "画面恢复实时", "冻结仅影响显示，不改变编码器采样");
  }

  function syncOverlayVisibility() {
    setButtonActive($("overlayToggleBtn"), state.overlayEnabled);
    const panel = $("grayProfilePanel");
    if (panel) {
      panel.hidden = !state.overlayEnabled;
    }
  }

  function toggleOverlay() {
    state.overlayEnabled = !state.overlayEnabled;
    syncOverlayVisibility();
    if (state.overlayEnabled) {
      window.setTimeout(() => runVisionAnalysis(), 30);
    }
    toast(
      state.overlayEnabled ? "识别叠加层与灰度曲线已显示" : "识别叠加层与灰度曲线已隐藏",
      "仅影响视野标注与曲线显示，不改变保存的原始帧。"
    );
  }

  function createRawOpticalFrame() {
    const source = $("opticCanvas");
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (state.camera.active && state.camera.video?.readyState >= 2) {
      drawCameraCover(context, canvas.width, canvas.height);
    } else if (!drawDemoVideoFrame(context, canvas.width, canvas.height)) {
      drawSyntheticOptics(context, canvas.width, canvas.height, performance.now());
    }
    return canvas;
  }

  function updateGrayCurve(result) {
    const profile = Array.isArray(result.horizontalProfile)
      ? result.horizontalProfile
      : Array.isArray(result.rightProfile)
        ? result.rightProfile
        : [];
    const smoothed = Array.isArray(result.horizontalSmoothedProfile)
      ? result.horizontalSmoothedProfile
      : [];
    if (!profile.length || !smoothed.length) return;

    state.vision.grayCurve = {
      profile: profile.slice(),
      smoothed: smoothed.slice(),
      valleys: (result.horizontalValleys || []).map((valley) => ({ ...valley })),
      centralDarkSpot: result.centralDarkSpot ? { ...result.centralDarkSpot } : null,
      removedCentralValleys: (result.removedCentralValleys || []).map((valley) => ({ ...valley })),
      smoothingWindow: numberOr(result.horizontalSmoothingWindow, 0),
      profileHalfWidth: numberOr(result.profileHalfWidth, 0),
      startXPx: numberOr(result.horizontalStartXPx, 0),
      stepPx: numberOr(result.horizontalStepPx, 1),
      processingLongEdge: numberOr(result.processingLongEdge, 0),
      sampledWidth: numberOr(result.sampledWidth, 0),
      sampledHeight: numberOr(result.sampledHeight, 0)
    };
    state.vision.centralDarkSpot = result.centralDarkSpot
      ? { detected: true, ...result.centralDarkSpot }
      : { detected: false };
    if (result.centralDarkSpot) {
      state.vision.lastCentralAt = Date.now();
    }
    drawGrayProfileChart();
  }

  function drawGrayProfileChart() {
    const canvas = $("grayCurveCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const curve = state.vision.grayCurve;
    const smoothed = Array.isArray(curve?.smoothed)
      ? curve.smoothed.filter((value) => Number.isFinite(value))
      : [];

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = CANVAS_THEME.surface;
    ctx.fillRect(0, 0, width, height);

    if (smoothed.length < 2) {
      ctx.fillStyle = CANVAS_THEME.muted;
      ctx.font = "12px Microsoft YaHei UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("等待实时目镜画面生成灰度剖面", width / 2, height / 2);
      $("grayProfileMeta").textContent = "整幅水平灰度带 · 等待识别";
      $("grayCurrentValue").textContent = "--";
      $("graySmoothedValue").textContent = "--";
      $("grayRangeValue").textContent = "--";
      $("graySamplePosition").textContent = "--";
      return;
    }

    const profile = Array.isArray(curve.profile) && curve.profile.length
      ? curve.profile
      : smoothed;
    const sampleCount = Math.max(profile.length, smoothed.length);
    const padding = { left: 48, right: 18, top: 15, bottom: 27 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const values = [...profile, ...smoothed].filter((value) => Number.isFinite(value));
    const dataMinimum = Math.min(...values);
    const dataMaximum = Math.max(...values);
    const dataRange = Math.max(1, dataMaximum - dataMinimum);
    const yPadding = Math.max(2.5, dataRange * 0.09);
    const yMinimum = Math.max(0, dataMinimum - yPadding);
    const yMaximum = Math.min(255, dataMaximum + yPadding);
    const yRange = Math.max(1, yMaximum - yMinimum);
    const xFor = (index) => padding.left + index / Math.max(1, sampleCount - 1) * innerWidth;
    const yFor = (value) => padding.top + (yMaximum - value) / yRange * innerHeight;
    const calibrationIndex = clamp(
      Math.round(
        (calibrationXPx() - numberOr(curve.startXPx, 0))
        / Math.max(numberOr(curve.stepPx, 1), 0.0001)
      ),
      0,
      sampleCount - 1
    );
    const currentRawValue = numberOr(profile[calibrationIndex], numberOr(smoothed[calibrationIndex], 0));
    const currentSmoothValue = numberOr(smoothed[calibrationIndex], currentRawValue);
    const currentSampleXPx = numberOr(curve.startXPx, 0) + calibrationIndex * numberOr(curve.stepPx, 1);
    $("grayCurrentValue").textContent = currentRawValue.toFixed(0);
    $("graySmoothedValue").textContent = currentSmoothValue.toFixed(0);
    $("grayRangeValue").textContent = `${dataMinimum.toFixed(0)}–${dataMaximum.toFixed(0)}`;
    $("graySamplePosition").textContent = `${Math.round(currentSampleXPx)}px`;

    ctx.strokeStyle = "#d3dee3";
    ctx.lineWidth = 1;
    ctx.fillStyle = CANVAS_THEME.muted;
    ctx.font = "9px Microsoft YaHei UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const y = padding.top + innerHeight * ratio;
      const value = yMaximum - yRange * ratio;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(value)), padding.left - 7, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const x = padding.left + innerWidth * ratio;
      ctx.strokeStyle = index === 0 ? CANVAS_THEME.line : "#dce5e9";
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.fillStyle = CANVAS_THEME.muted;
      ctx.fillText(`${Math.round(ratio * 100)}%`, x, height - 8);
    }

    const fill = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    fill.addColorStop(0, "rgba(69, 93, 107, 0.035)");
    fill.addColorStop(1, "rgba(69, 93, 107, 0.14)");
    ctx.beginPath();
    smoothed.forEach((value, index) => {
      const x = xFor(index);
      const y = yFor(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xFor(smoothed.length - 1), height - padding.bottom);
    ctx.lineTo(xFor(0), height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    const drawSeries = (series, color, lineWidth) => {
      ctx.beginPath();
      series.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        const x = xFor(index);
        const y = yFor(value);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    };

    drawSeries(profile, "rgba(124, 133, 138, 0.62)", 1);
    drawSeries(smoothed, CANVAS_THEME.blueDark, 2);

    const currentX = xFor(calibrationIndex);
    const currentY = clamp(yFor(currentSmoothValue), padding.top + 2, height - padding.bottom - 2);
    ctx.strokeStyle = "rgba(79, 120, 148, 0.72)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, height - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = CANVAS_THEME.blue;
    ctx.beginPath();
    ctx.arc(currentX, currentY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = CANVAS_THEME.surface;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = CANVAS_THEME.blueDark;
    ctx.font = "12px Microsoft YaHei UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`当前 m=${state.ringSequence.currentOrder}`, currentX + 7, currentY - 7);

    const valleys = Array.isArray(curve.valleys) ? curve.valleys : [];
    valleys.forEach((valley, displayIndex) => {
      const profileIndex = clamp(Math.round(numberOr(valley.profileIndex, -1)), 0, sampleCount - 1);
      if (profileIndex < 0) return;
      const value = numberOr(valley.value, smoothed[profileIndex]);
      const x = xFor(profileIndex);
      const y = clamp(yFor(value), padding.top + 2, height - padding.bottom - 2);
      const active = Math.abs(numberOr(valley.xPx, -Infinity) - calibrationXPx()) <= 22;

      ctx.strokeStyle = active ? "rgba(215, 157, 84, 0.82)" : "rgba(124, 133, 138, 0.3)";
      ctx.lineWidth = active ? 1.4 : 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = active ? "#a56f30" : "#7c858a";
      ctx.beginPath();
      ctx.arc(x, y, active ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();

      if (displayIndex < 10 || displayIndex % 5 === 0) {
        ctx.fillStyle = active ? "#a56f30" : "#7c858a";
        ctx.font = active
          ? "13px Microsoft YaHei UI, sans-serif"
          : "8px Microsoft YaHei UI, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("谷", x, y - 5 - (displayIndex % 2) * 13);
      }
    });

    ctx.fillStyle = CANVAS_THEME.muted;
    ctx.font = "9px Microsoft YaHei UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("灰度值", 8, padding.top + 5);
    ctx.textAlign = "right";
    ctx.fillText(`左侧 ← 标定线 ${Math.round(calibrationXPx())}px → 右侧`, width - padding.right, height - 8);

    const lastXPx = numberOr(curve.startXPx, 0)
      + Math.max(0, sampleCount - 1) * numberOr(curve.stepPx, 1);
    $("grayProfileMeta").textContent =
      `整幅 ${Math.round(numberOr(curve.startXPx, 0))}–${Math.round(lastXPx)} px · 处理 ${Math.round(numberOr(curve.processingLongEdge, 0))} px · 平滑 ${Math.round(numberOr(curve.smoothingWindow, 0))} px · ${valleys.length} 个谷值`;
  }

  function sequenceDetectionOptions() {
    const crossings = state.ringSequence.rightCount + state.ringSequence.leftCount;
    if (crossings < 2) return { smoothingWindow: 22, minimumDepth: 13 };
    if (crossings < 26) return { smoothingWindow: 7, minimumDepth: 6 };
    return { smoothingWindow: 4, minimumDepth: 3 };
  }

  function processHorizontalValleySequence(result, started) {
    const sequence = state.ringSequence;
    const sourceWidth = numberOr(result.sourceWidth, $("opticCanvas").width || 1280);
    const calibration = calibrationXPx();
    const deadZonePx = Math.max(3, sourceWidth * (3 / 640));

    const currentValleys = (result.horizontalValleys || [])
      .filter((valley) => Number.isFinite(Number(valley.xPx)))
      .slice()
      .sort((left, right) => Number(left.xPx) - Number(right.xPx));
    const valleySpacings = currentValleys
      .slice(1)
      .map((valley, index) => Number(valley.xPx) - Number(currentValleys[index].xPx))
      .filter((spacing) => Number.isFinite(spacing) && spacing > 2);
    const typicalSpacing = valleySpacings.length
      ? valleySpacings.slice().sort((left, right) => left - right)[Math.floor(valleySpacings.length / 2)]
      : 12;
    const matchDistancePx = clamp(typicalSpacing * 0.55, 6, 32);
    sequence.deadZonePx = deadZonePx;
    sequence.matchDistancePx = matchDistancePx;
    const removedCentralValleys = (result.removedCentralValleys || [])
      .filter((valley) => Number.isFinite(Number(valley.xPx)));
    removedCentralValleys.forEach((valley) => {
      const exclusionRadius = Math.max(8, numberOr(valley.widthPx, 0) * 0.5);
      for (const [trackId, track] of sequence.tracks.entries()) {
        if (Math.abs(numberOr(track.xPx, -Infinity) - Number(valley.xPx)) <= exclusionRadius) {
          sequence.tracks.delete(trackId);
        }
      }
    });
    const previousTracks = Array.from(sequence.tracks.entries())
      .sort((left, right) => left[1].xPx - right[1].xPx);
    const pairs = [];
    const usedTrackIds = new Set();
    const usedValleyIndexes = new Set();

    currentValleys.forEach((valley, valleyIndex) => {
      let bestTrack = null;
      let bestDistance = matchDistancePx + 1;
      for (const [trackId, track] of previousTracks) {
        if (usedTrackIds.has(trackId)) continue;
        const distance = Math.abs(Number(valley.xPx) - track.xPx);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTrack = { trackId, track };
        }
      }
      if (!bestTrack) return;
      usedTrackIds.add(bestTrack.trackId);
      usedValleyIndexes.add(valleyIndex);
      pairs.push({ ...bestTrack, valley });
    });

    const nextTracks = new Map();
    const recordedCrossings = [];
    if (sequence.cooldownFrames > 0) sequence.cooldownFrames -= 1;

    for (const { trackId, track, valley } of pairs) {
      const oldSide = numberOr(track.side, 0);
      const currentSide = valley.xPx < calibration - deadZonePx
        ? -1
        : valley.xPx > calibration + deadZonePx ? 1 : 0;
      if (currentSide === 0) track.crossedDeadZone = true;
      const crossingDirection = currentSide !== 0 && oldSide !== 0
        ? Math.sign(currentSide - oldSide)
        : 0;
      const crossed = oldSide !== 0
        && currentSide !== 0
        && oldSide !== currentSide
        && Boolean(track.crossedDeadZone);
      const sameScanDirection = sequence.crossingDirection === 0
        || crossingDirection === sequence.crossingDirection;

      if (
        crossed
        && sameScanDirection
        && sequence.cooldownFrames === 0
        && !sequence.completed
      ) {
        const recorded = recordSequencePoint({
          automatic: true,
          valleyXPx: valley.xPx,
          crossingDirection
        });
        if (recorded) {
          recordedCrossings.push(recorded);
          track.order = recorded.order;
          track.crossedDeadZone = false;
          sequence.cooldownFrames = 1;
        }
      }

      track.side = currentSide !== 0 ? currentSide : oldSide;
      track.xPx = Number(valley.xPx);
      track.value = numberOr(valley.value, track.value);
      track.missed = 0;
      nextTracks.set(trackId, track);
    }

    for (const [trackId, track] of sequence.tracks.entries()) {
      if (usedTrackIds.has(trackId)) continue;
      track.missed = numberOr(track.missed, 0) + 1;
      if (track.missed <= 10) nextTracks.set(trackId, track);
    }

    currentValleys.forEach((valley, index) => {
      if (usedValleyIndexes.has(index)) return;
      const trackId = sequence.nextTrackId++;
      nextTracks.set(trackId, {
        xPx: Number(valley.xPx),
        value: numberOr(valley.value, 0),
        side: 0,
        crossedDeadZone: false,
        missed: 0
      });
    });

    sequence.tracks = nextTracks;
    sequence.lastCrossingAt = recordedCrossings.length
      ? new Date().toISOString()
      : sequence.lastCrossingAt;
    state.vision.lastAt = new Date().toISOString();
    state.vision.latencyMs = performance.now() - started;
    state.vision.status = "ready";
    state.vision.confidence = currentValleys.length
      ? mean(currentValleys.map((valley) => numberOr(valley.confidence, 0.7)))
      : 0;
    state.ringSummary.status = sequence.completed ? "ready" : "active";
    state.ringSummary.lastDetectedAt = new Date().toISOString();
    persistRingSequence();
    renderRingSummary();
    updateVisionUI();
    persistSession(false);
    return recordedCrossings.at(-1) || null;
  }

  async function runVisionAnalysis(options = {}) {
    const automatic = Boolean(options.automatic);
    if (state.vision.analyzing) return;
    if (!window.NewtonRingDetector) {
      toast("环检测模块未载入", "请刷新页面后重新识别。", "error");
      return;
    }
    state.vision.analyzing = true;
    if (!automatic) {
      state.vision.status = "running";
      state.ringSummary.status = "running";
      updateVisionUI();
      $("visionProgress").classList.add("active");
    }
    const started = performance.now();

    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const frame = createRawOpticalFrame();
      const usingDemoVideo = !state.camera.active && state.camera.demoVideoReady;
      const sequenceOptions = sequenceDetectionOptions();
      const detectOptions = {
        profileHalfWidth: 5,
        processingLongEdge: 1280,
        smoothingWindow: sequenceOptions.smoothingWindow,
        minimumDistance: 8,
        minimumDepth: sequenceOptions.minimumDepth,
        centralWidthRatio: 2.2
      };
      let result = window.NewtonRingDetector.detectDarkRings(frame, detectOptions);
      const minimumUsefulValleys = Math.min(
        12,
        Math.max(4, state.ringSequence.startOrder + 2)
      );
      if (result.horizontalValleys.length < minimumUsefulValleys && sequenceOptions.smoothingWindow > 7) {
        result = window.NewtonRingDetector.detectDarkRings(frame, {
          ...detectOptions,
          smoothingWindow: 7,
          minimumDepth: 6,
          centralWidthRatio: 2.2
        });
      }
      if (result.horizontalValleys.length < minimumUsefulValleys && sequenceOptions.smoothingWindow > 4) {
        result = window.NewtonRingDetector.detectDarkRings(frame, {
          ...detectOptions,
          smoothingWindow: 4,
          minimumDepth: 3,
          centralWidthRatio: 2.2
        });
      }
      if (
        !result.centralDarkSpot
        && state.vision.centralDarkSpot?.detected
        && Date.now() - state.vision.lastCentralAt < 1200
      ) {
        result = {
          ...result,
          centralDarkSpot: { ...state.vision.centralDarkSpot }
        };
      }
      updateGrayCurve(result);
      const autoRecorded = processHorizontalValleySequence(result, started);
      const detected = result.horizontalValleys.length;
      if (!automatic) {
        toast(
          detected ? `已识别 ${detected} 个灰度谷值` : "未识别到灰度谷值",
          autoRecorded
            ? `谷值穿越标定线，已记录 m=${autoRecorded.order} ${autoRecorded.side === "left" ? "左" : "右"}侧 · ${Number(autoRecorded.readingMm).toFixed(3)} mm。`
            : state.ringSequence.completed
              ? "左右两侧顺序记录已经完成，可点击“重新开始计数”。"
              : `等待谷值穿过固定标定线，下一测点为 m=${state.ringSequence.currentOrder} ${state.ringSequence.phase === "left" ? "左" : "右"}侧。`,
          detected ? undefined : "warn"
        );
      }
    } catch (error) {
      console.error(error);
      state.vision.status = "error";
      state.ringSummary.status = "error";
      state.vision.latencyMs = performance.now() - started;
      if (!automatic) {
        addEvent("warning", "暗环识别失败", error.message || "图像处理异常", { severity: "warn" });
        toast("暗环识别失败", "请检查目镜画面、对焦与十字标线后重试。", "error");
      } else if (Date.now() - state.vision.lastAutoErrorAt > 8000) {
        state.vision.lastAutoErrorAt = Date.now();
        addEvent("warning", "自动识别暂未取得暗环", error.message || "图像处理异常", { severity: "warn" });
      }
      updateVisionUI();
    } finally {
      state.vision.analyzing = false;
      $("visionProgress").classList.remove("active");
    }
  }

  function applyVisionPayload(payload, started) {
    const centerData = payload.center || {};
    const centerX = numberOr(centerData.cx_pixel_refined, numberOr(centerData.cx_pixel, state.vision.center.x));
    const centerY = numberOr(centerData.cy_pixel_refined, numberOr(centerData.cy_pixel, state.vision.center.y));
    const ringContainer = payload.rings || {};
    const rings = Array.isArray(ringContainer.rings)
      ? ringContainer.rings
      : Array.isArray(ringContainer)
        ? ringContainer
        : Array.isArray(payload.ringPositions)
          ? payload.ringPositions
          : [];
    const radii = rings
      .map((ring) => ({
        radius: numberOr(ring.radius_px, numberOr(ring.radius, 0)),
        confidence: numberOr(ring.confidence, 0.75),
        order: ring.ringOrder ?? ring.order
      }))
      .filter((ring) => ring.radius > 0)
      .sort((a, b) => a.radius - b.radius);

    const explicitOrder = payload.ringOrder
      ?? payload.ring_order
      ?? rings.find((ring) => ring.ringOrder != null)?.ringOrder
      ?? radii.find((ring) => ring.order != null)?.order;
    const crossX = $("opticCanvas").width / 2;
    const crossY = $("opticCanvas").height / 2;
    const crossRadius = Math.hypot(crossX - centerX, crossY - centerY);
    const nearest = radii.reduce((best, ring) => {
      if (!best) return ring;
      return Math.abs(ring.radius - crossRadius) < Math.abs(best.radius - crossRadius) ? ring : best;
    }, null);
    const nearestIndex = nearest ? radii.indexOf(nearest) : 0;
    const autoOrder = explicitOrder != null
      ? Number(explicitOrder)
      : settings.ringBase + nearestIndex;

    state.vision.center = { x: centerX, y: centerY };
    state.vision.ringRadii = radii;
    state.vision.confidence = clamp(
      numberOr(nearest?.confidence, numberOr(payload.quality?.confidence, 0.82)),
      0,
      1
    );
    state.vision.latencyMs = numberOr(payload.elapsed_ms, performance.now() - started);
    state.vision.lastAt = new Date().toISOString();
    state.vision.status = "ready";
    state.vision.serviceOnline = true;
    if (Date.now() > state.manualRingUntil) {
      setCurrentRingOrder(autoOrder);
    }
    addEvent(
      "vision",
      "完成自动环级判读",
      `m=${state.currentRingOrder} · ${state.vision.ringRadii.length} 条环纹 · 耗时 ${Math.round(state.vision.latencyMs)} ms`
    );
    updateVisionUI();
  }

  async function probeVisionService(url, notify = true) {
    if (!url) {
      if (notify) toast("请填写判读服务地址", "例如 http://127.0.0.1:18080/api/analyze。", "warn");
      return false;
    }
    const healthUrl = url.replace(/\/api\/analyze.*$/, "/api/health");
    try {
      const response = await fetchWithTimeout(healthUrl, { method: "GET" }, 3000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.vision.status = "ready";
      state.vision.serviceOnline = true;
      setStatusChip("vision", "online", "判读服务在线");
      if (notify) toast("判读服务可访问", healthUrl);
      updateVisionUI();
      return true;
    } catch (error) {
      state.vision.status = "error";
      state.vision.serviceOnline = false;
      setStatusChip("vision", "error", "判读服务离线");
      if (notify) toast("判读服务不可访问", "请先启动视觉服务，或检查地址与端口。", "error");
      updateVisionUI();
      return false;
    }
  }

  async function testVisionService() {
    const url = $("visionUrlInput").value.trim();
    $("testVisionBtn").disabled = true;
    try {
      await probeVisionService(url, true);
    } finally {
      $("testVisionBtn").disabled = false;
    }
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => window.clearTimeout(timer));
  }

  function startVisionInterval() {
    clearVisionInterval();
    const seconds = numberOr(settings.visionInterval, 0);
    if (seconds <= 0) return;
    state.visionTimer = window.setInterval(() => {
      if (demoVisualsPaused()) return;
      const frameAvailable = state.camera.active
        ? !state.camera.frameFrozen
        : state.camera.demoVideoReady && !state.camera.frameFrozen;
      if (frameAvailable && state.view === "live") {
        runVisionAnalysis({ automatic: true });
      }
    }, seconds * 1000);
  }

  function clearVisionInterval() {
    if (state.visionTimer) {
      window.clearInterval(state.visionTimer);
      state.visionTimer = null;
    }
  }

  function drawFitChart(fit) {
    const canvas = $("fitChart");
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const padding = { left: 68, right: 28, top: 26, bottom: 47 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    if (!fit) {
      ctx.fillStyle = CANVAS_THEME.surfaceMid;
      ctx.fillRect(padding.left, padding.top, innerWidth, innerHeight);
      return;
    }

    const minX = Math.min(...fit.xs) - 0.8;
    const maxX = Math.max(...fit.xs) + 0.8;
    const allY = [...fit.ys, ...fit.fitted];
    const minY = Math.min(...allY) - Math.max(0.8, (Math.max(...allY) - Math.min(...allY)) * 0.12);
    const maxY = Math.max(...allY) + Math.max(0.8, (Math.max(...allY) - Math.min(...allY)) * 0.12);
    const xScale = (value) => padding.left + (value - minX) / (maxX - minX) * innerWidth;
    const yScale = (value) => padding.top + innerHeight - (value - minY) / (maxY - minY) * innerHeight;

    ctx.fillStyle = CANVAS_THEME.surface;
    ctx.fillRect(padding.left, padding.top, innerWidth, innerHeight);
    ctx.strokeStyle = "#d7e1e6";
    ctx.lineWidth = 1;
    for (let index = 0; index <= 5; index += 1) {
      const y = padding.top + innerHeight / 5 * index;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }
    for (let index = 0; index <= 6; index += 1) {
      const x = padding.left + innerWidth / 6 * index;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
    }

    ctx.strokeStyle = "#879ba6";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    ctx.fillStyle = CANVAS_THEME.muted;
    ctx.font = "12px Cascadia Mono, Consolas, monospace";
    ctx.textAlign = "center";
    for (let index = 0; index <= 6; index += 1) {
      const value = minX + (maxX - minX) * index / 6;
      const x = padding.left + innerWidth * index / 6;
      ctx.fillText(value.toFixed(1), x, height - 24);
    }
    ctx.textAlign = "right";
    for (let index = 0; index <= 5; index += 1) {
      const value = maxY - (maxY - minY) * index / 5;
      const y = padding.top + innerHeight * index / 5;
      ctx.fillText(value.toFixed(1), padding.left - 11, y + 4);
    }
    ctx.textAlign = "left";
    ctx.fillText("m / ring order", width - padding.right - 104, height - 7);
    ctx.save();
    ctx.translate(17, padding.top + 88);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("D² / mm²", 0, 0);
    ctx.restore();

    const startX = minX;
    const endX = maxX;
    ctx.strokeStyle = CANVAS_THEME.blueDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xScale(startX), yScale(fit.slope * startX + fit.intercept));
    ctx.lineTo(xScale(endX), yScale(fit.slope * endX + fit.intercept));
    ctx.stroke();

    fit.pairs.forEach((pair, index) => {
      const x = xScale(fit.xs[index]);
      const y = yScale(fit.ys[index]);
      const fittedY = yScale(fit.fitted[index]);
      const outlier = Math.abs(fit.residualSigma[index]) > numberOr(state.session.residualThreshold, 2.5);
      ctx.strokeStyle = outlier ? "rgba(215, 157, 84, .48)" : "rgba(98, 100, 100, .2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, fittedY);
      ctx.stroke();
      ctx.fillStyle = outlier ? "#a56f30" : CANVAS_THEME.ink;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = CANVAS_THEME.surface;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    const annotation = `R² ${fit.r2.toFixed(5)}   n=${fit.pairs.length}`;
    const metrics = ctx.measureText(annotation);
    ctx.fillStyle = "rgba(247, 249, 250, .94)";
    ctx.fillRect(width - padding.right - metrics.width - 20, padding.top + 10, metrics.width + 14, 26);
    ctx.fillStyle = CANVAS_THEME.inkSoft;
    ctx.font = "11px Cascadia Mono, Consolas, monospace";
    ctx.fillText(annotation, width - padding.right - metrics.width - 13, padding.top + 27);
  }

  function downloadBlob(filename, content, type = "application/json") {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportSessionJson() {
    persistSession(true);
    const payload = {
      exportedAt: new Date().toISOString(),
      schema: "newton-ring-fusion-session",
      version: state.session.version,
      settings: { ...settings },
      session: state.session,
      diagnostics: generateDiagnostics()
    };
    downloadBlob(`${state.session.code}-fusion.json`, JSON.stringify(payload, null, 2));
    addEvent("archive", "实验会话已导出", "JSON 包含原始测点、配对、事件与诊断结果");
  }

  function exportPairsCsv() {
    const pairs = sortedPairs();
    if (!pairs.length) {
      toast("没有可导出的数据", "请先完成至少一组左右测点配对。", "warn");
      return;
    }
    const comparisonByOrder = new Map(
      studentComparisonRows().map((row) => [Number(row.order), row])
    );
    const header = [
      "order",
      "left_mm",
      "right_mm",
      "diameter_mm",
      "diameter_squared_mm2",
      "confidence",
      "student_left_mm",
      "student_right_mm",
      "left_difference_mm",
      "right_difference_mm",
      "student_diameter_mm",
      "diameter_difference_mm"
    ];
    const rows = pairs.map((pair) => {
      const comparison = comparisonByOrder.get(Number(pair.order));
      return [
        pair.order,
        numberOr(pair.left?.positionMm, 0).toFixed(3),
        numberOr(pair.right?.positionMm, 0).toFixed(3),
        numberOr(pair.diameterMm, 0).toFixed(3),
        numberOr(pair.diameterSquared, 0).toFixed(3),
        numberOr(pair.confidence, 0).toFixed(4),
        Number.isFinite(comparison?.studentLeft) ? comparison.studentLeft.toFixed(3) : "",
        Number.isFinite(comparison?.studentRight) ? comparison.studentRight.toFixed(3) : "",
        Number.isFinite(comparison?.leftDiff) ? comparison.leftDiff.toFixed(3) : "",
        Number.isFinite(comparison?.rightDiff) ? comparison.rightDiff.toFixed(3) : "",
        Number.isFinite(comparison?.studentDiameter) ? comparison.studentDiameter.toFixed(3) : "",
        Number.isFinite(comparison?.diameterDiff) ? comparison.diameterDiff.toFixed(3) : ""
      ];
    });
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.join(",")).join("\r\n");
    downloadBlob(`${state.session.code}-pairs.csv`, csv, "text/csv;charset=utf-8");
    toast("CSV 已导出", `${pairs.length} 组配对测量数据。`);
  }

  function downloadReport() {
    const diagnostics = generateDiagnostics();
    const fit = diagnostics.fit;
    const pairs = sortedPairs();
    const lines = [
      `# 牛顿环实验过程与结果诊断报告`,
      "",
      `- 报告编号：${state.session.code.replace("NR-", "RPT-")}`,
      `- 实验者：${state.session.student || "未填写"}`,
      `- 组别：${state.session.group || "未分组"}`,
      `- 日期：${formatDate(state.session.startedAt)}`,
      `- 装置编号：${state.session.deviceId || "NR-FUSION-01"}`,
      "",
      `## 实验摘要`,
      "",
      fit
        ? `本次实验形成 ${pairs.length} 组左右配对测点。测得 R = ${fit.rMeters.toFixed(3)} m，相对偏差 ${signed(fit.relativeError, 2)}%，R² = ${fit.r2.toFixed(3)}。${diagnostics.summary}`
        : "当前有效配对不足，尚无法进行可靠拟合。",
      "",
      `## 配对测量`,
      "",
      "| m | 左读数/mm | 右读数/mm | D/mm | D²/mm² |",
      "|---:|---:|---:|---:|---:|",
      ...pairs.map((pair) => `| ${pair.order} | ${numberOr(pair.left?.positionMm, 0).toFixed(3)} | ${numberOr(pair.right?.positionMm, 0).toFixed(3)} | ${numberOr(pair.diameterMm, 0).toFixed(3)} | ${numberOr(pair.diameterSquared, 0).toFixed(3)} |`),
      "",
      `## 学生逐环对照`,
      "",
      studentRows.length
        ? "| m | 学生左 | 学生右 | 平台左 | 平台右 | 左差值 | 右差值 | 学生 D | 平台 D | D 差值 |"
        : "尚未录入学生逐环左右读数。",
      ...(studentRows.length ? [
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ...studentRows.map((row) => `| ${row.order} | ${Number.isFinite(row.studentLeft) ? row.studentLeft.toFixed(3) : "--"} | ${Number.isFinite(row.studentRight) ? row.studentRight.toFixed(3) : "--"} | ${Number.isFinite(row.platformLeft) ? row.platformLeft.toFixed(3) : "--"} | ${Number.isFinite(row.platformRight) ? row.platformRight.toFixed(3) : "--"} | ${Number.isFinite(row.leftDiff) ? signed(row.leftDiff, 3) : "--"} | ${Number.isFinite(row.rightDiff) ? signed(row.rightDiff, 3) : "--"} | ${Number.isFinite(row.studentDiameter) ? row.studentDiameter.toFixed(3) : "--"} | ${Number.isFinite(row.platformDiameter) ? row.platformDiameter.toFixed(3) : "--"} | ${Number.isFinite(row.diameterDiff) ? signed(row.diameterDiff, 3) : "--"} |`)
      ] : []),
      "",
      `## AI 诊断`,
      "",
      ...diagnostics.findings.map((finding) => `- **${finding.title}**：${finding.detail}`),
      "",
      `## 学生数据对照`,
      "",
      diagnostics.comparison
        ? `平台拟合 R = ${fit.rMeters.toFixed(3)} m；学生采用${diagnostics.comparison.method}得到 R = ${diagnostics.comparison.studentR.toFixed(3)} m；差值 ${signed(diagnostics.comparison.difference, 3)} m（${signed(diagnostics.comparison.differencePercent, 2)}%）；结论：${diagnostics.comparison.label}。`
        : "尚未录入学生手工核算结果。",
      "",
      `## 建议`,
      "",
      ...diagnostics.recommendations.map((recommendation) => `- ${recommendation}`),
      "",
      `> 本报告由平台依据编码器原始计数、视觉判读结果与配对测量记录自动生成。AI 诊断仅提供实验质量线索，不替代人工复核。`,
      "",
      `生成时间：${formatDateTime(new Date())}`
    ];
    downloadBlob(`${state.session.code}-diagnosis.md`, lines.join("\n"), "text/markdown;charset=utf-8");
    addEvent("report", "诊断报告已生成", "报告下载为 Markdown 文件");
  }

  function applySettingsFromInputs() {
    settings.wsUrl = $("wsUrlInput").value.trim() || DEFAULT_SETTINGS.wsUrl;
    settings.visionUrl = $("visionUrlInput").value.trim() || DEFAULT_SETTINGS.visionUrl;
    settings.countsPerRev = Math.max(1, numberOr($("countsPerRevInput").value, DEFAULT_SETTINGS.countsPerRev));
    settings.pitchMm = Math.max(0.001, numberOr($("pitchInput").value, DEFAULT_SETTINGS.pitchMm));
    settings.direction = $("directionInput").value === "-1" ? -1 : 1;
    settings.zeroOffsetMm = numberOr($("zeroOffsetInput").value, 0);
    settings.ringBase = clamp(
      Math.round(numberOr($("ringBaseInput").value, 1)),
      1,
      RING_MAX_DETECTED
    );
    settings.visionInterval = Math.max(0, numberOr($("visionIntervalInput").value, 0));
    settings.cameraRotationDeg = [-90, 0, 90, 180].includes(Number($("cameraRotationInput").value))
      ? Number($("cameraRotationInput").value)
      : -90;
    settings.settingsVersion = 8;
    saveJson(SETTINGS_KEY, settings);
    state.encoder.countsPerRev = settings.countsPerRev;
    state.encoder.pitchMm = settings.pitchMm;
    state.encoder.zeroOffsetMm = settings.zeroOffsetMm;
    state.encoder.direction = settings.direction;
    state.encoder.angleDeg = normalizeAngle(state.encoder.raw / settings.countsPerRev * 360);
    state.encoder.positionMm = encoderPosition(state.encoder.raw);
    calibrateLiveModelScale();
    updateSessionHeader();
    updateEncoderUI();
    startVisionInterval();
    resetRingSequence();
    toast("设置已保存", `左侧第一个暗环设为 m=${settings.ringBase}，顺序计数已重置。`);
  }

  function openSettings(focus) {
    $("wsUrlInput").value = settings.wsUrl;
    $("visionUrlInput").value = settings.visionUrl;
    $("countsPerRevInput").value = String(settings.countsPerRev);
    $("pitchInput").value = String(settings.pitchMm);
    $("directionInput").value = String(settings.direction);
    $("zeroOffsetInput").value = String(settings.zeroOffsetMm);
    $("ringBaseInput").value = String(settings.ringBase);
    $("visionIntervalInput").value = String(settings.visionInterval);
    $("cameraRotationInput").value = String(settings.cameraRotationDeg);
    $("hardwareHelpText").textContent = state.encoder.mode === "demo"
      ? "当前使用内置演示信号。连接真实设备后将自动切换到实时数据。"
      : `当前编码器来源：${state.encoder.mode.toUpperCase()}。`;
    $("settingsDialog").showModal();
    if (focus) {
      window.setTimeout(() => {
        const target = focus === "controller"
          ? $("wsUrlInput")
          : focus === "vision" || focus === "camera"
            ? $("visionUrlInput")
            : $("countsPerRevInput");
        target?.focus();
      }, 60);
    }
  }

  function openSessionDialog() {
    $("studentNameInput").value = state.session.student === "演示实验者" ? "" : state.session.student || "";
    $("groupInput").value = state.session.group || "";
    $("lensInput").value = state.session.lens || "L-01";
    $("deviceIdInput").value = state.session.deviceId || "NR-FUSION-01";
    $("sessionWavelengthInput").value = String(state.session.wavelengthNm || 589.3);
    $("sessionReferenceRInput").value = String(state.session.referenceR || 1);
    $("sessionDialog").showModal();
    window.setTimeout(() => $("studentNameInput").focus(), 60);
  }

  function beginNewSession() {
    const now = new Date();
    const code = `NR-${formatDate(now).replace(/-/g, "")}-${String(Math.floor(Math.random() * 90) + 10)}`;
    const student = $("studentNameInput").value.trim() || "未填写实验者";
    const group = $("groupInput").value.trim() || "未分配组别";
    const lens = $("lensInput").value.trim() || "L-01";
    const deviceId = $("deviceIdInput").value.trim() || "NR-FUSION-01";
    const wavelengthNm = numberOr($("sessionWavelengthInput").value, 589.3);
    const referenceR = numberOr($("sessionReferenceRInput").value, 1);
    state.session = {
      id: uid("session"),
      code,
      student,
      group,
      lens,
      deviceId,
      wavelengthNm,
      referenceR,
      fitMode: "intercept",
      residualThreshold: 2.5,
      studentResultR: null,
      studentUncertaintyR: null,
      studentMethod: "逐差法",
      studentReadings: [],
      startedAt: now.toISOString(),
      elapsedMs: 0,
      status: "active",
      demo: state.encoder.mode === "demo",
      pairs: [],
      captures: [],
      ringRecords: [],
      ringSequence: null,
      events: [],
      version: "fusion-1.0"
    };
    addEvent("session", "实验会话已开始", `${student} · ${group} · ${deviceId}`, { silent: true });
    addEvent("encoder", state.encoder.mode === "demo" ? "演示编码器已启用" : "编码器已处于在线状态", `换算系数 ${settings.pitchMm.toFixed(3)} mm/rev`, { silent: true });
    state.manualRingUntil = 0;
    state.measurementMotion = {
      lastCapturePosition: null,
      direction: 0,
      lastCaptureAt: null,
      lastRaw: null,
      recentLatencies: []
    };
    state.vision.lockUntil = 0;
    resetRingSequence();
    renderAll();
    persistSession(true);
    toast("新实验已开始", `${code} · 可开始记录左右测点。`);
  }

  function loadDemoData(options = {}) {
    if (!options.force && state.session.pairs.length && !window.confirm("载入示例会覆盖当前会话数据，是否继续？")) {
      return;
    }
    const demo = buildDemoSession();
    state.session = demo;
    if (state.encoder.mode === "demo") {
      const startMm = EMBED_MODE ? DEMO_TRAVEL_MIN_MM : configuredStartPositionMm();
      if (EMBED_MODE) {
        settings.startPositionMm = startMm;
        state.esp.modelAnchorMm = startMm;
      }
      state.encoder.lastDemoRaw = encoderRawForPosition(startMm);
      state.encoder.raw = state.encoder.lastDemoRaw;
      state.encoder.angleDeg = normalizeAngle(
        state.encoder.raw / Math.max(1, state.encoder.countsPerRev) * 360
      );
      state.encoder.positionMm = startMm;
      state.encoder.relativeMm = 0;
      state.encoder.demoDirection = 1;
      state.encoder.demoPauseUntil = 0;
      state.liveModelViewer?.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
      setDemoMotion(EMBED_MODE);
    }
    const demoStartOrder = Math.max(settings.ringBase, ...demo.pairs.map((pair) => Number(pair.order)));
    state.ringSequence = normalizedRingSequence({
      startOrder: demoStartOrder,
      currentOrder: demoStartOrder,
      phase: "left",
      rightCount: demoStartOrder,
      leftCount: demoStartOrder,
      completed: true
    });
    state.currentRingOrder = demoStartOrder;
    state.manualRingUntil = 0;
    state.measurementMotion = {
      lastCapturePosition: null,
      direction: 0,
      lastCaptureAt: null,
      lastRaw: null,
      recentLatencies: []
    };
    state.ringSummary = { status: "ready", rows: sequenceDisplayRows(), activeIndex: null, pendingIndex: null, lastDetectedAt: null };
    state.vision.lockUntil = 0;
    persistRingSequence();
    renderAll();
    persistSession(true);
    if (options.notify !== false) {
      toast("示例会话已载入", "已生成 30 级左右配对、学生读数和诊断报告。");
    }
  }

  function toggleSessionPause() {
    if (state.session.status === "paused") {
      state.session.status = "active";
      state.encoder.demoPauseUntil = 0;
      addEvent("session", "实验会话已继续", "计时器恢复");
      toast("会话已继续", "可以继续记录测点。");
    } else {
      state.session.status = "paused";
      addEvent("pause", "实验会话已暂停", "计时和演示信号暂停");
      toast("会话已暂停", "当前编码器读数不再推进。", "warn");
    }
    syncDemoVisuals();
    updateSessionHeader();
    persistSession(true);
  }

  function normalizeEspAddress(value) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("请输入 ESP8266 地址");
    const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("只支持 HTTP 或 HTTPS 地址");
    }
    return parsed.origin;
  }

  function configuredStartPositionMm() {
    return Math.round(clamp(
      numberOr(settings.startPositionMm, MEASUREMENT_MAX_MM / 2),
      MEASUREMENT_MIN_MM,
      MEASUREMENT_MAX_MM
    ) * 1000) / 1000;
  }

  function updateStartPositionUI() {
    const input = $("startPositionInput");
    const hint = $("startPositionHint");
    if (!input || !hint) return;
    const startMm = configuredStartPositionMm();
    const locked =
      (state.encoder.mode === "esp" && Number.isFinite(state.esp.baselineValueMm))
      || (["ws", "serial"].includes(state.encoder.mode) && state.encoder.mainScaleBaselineRaw != null);
    hint.classList.toggle("locked", locked);
    hint.textContent = locked
      ? `已同步：当前值设为 0 点，读数 = ${startMm.toFixed(3)} + 相对位移`
      : state.encoder.mode === "demo"
        ? state.demoMotion
          ? `演示从 ${startMm.toFixed(3)} mm 开始，在 ${DEMO_TRAVEL_MIN_MM.toFixed(3)}–${DEMO_TRAVEL_MAX_MM.toFixed(3)} mm 内往返`
          : `已定位到 ${startMm.toFixed(3)} mm；点击“继续演示”开始运动`
        : state.esp.status === "online" || state.esp.status === "waiting"
          ? `等待设定：连接后首帧设为 0 点`
          : `连接后将首帧设为 0 点，读数 = ${startMm.toFixed(3)} + 相对位移`;
  }

  function setStartPosition(value, { announce = true } = {}) {
    const startMm = Math.round(clamp(
      numberOr(value, configuredStartPositionMm()),
      MEASUREMENT_MIN_MM,
      MEASUREMENT_MAX_MM
    ) * 1000) / 1000;
    settings.startPositionMm = startMm;
    state.esp.modelAnchorMm = startMm;
    $("startPositionInput").value = startMm.toFixed(3);
    saveJson(SETTINGS_KEY, settings);
    const demoSession = state.session.demo
      || state.encoder.mode === "demo"
      || state.encoder.mode === "connecting";

    const canLockEsp = state.encoder.mode === "esp"
      && state.esp.status === "online"
      && Number.isFinite(state.esp.lastValueMm);
    const canLockRaw = ["ws", "serial"].includes(state.encoder.mode)
      && Number.isFinite(state.encoder.lastHardwareRaw);

    if (state.encoder.mode === "demo") {
      state.encoder.lastDemoRaw = encoderRawForPosition(startMm);
      state.encoder.raw = state.encoder.lastDemoRaw;
      state.encoder.angleDeg = normalizeAngle(
        state.encoder.raw / Math.max(1, state.encoder.countsPerRev) * 360
      );
      state.encoder.previousPosition = null;
      state.encoder.positionMm = startMm;
      state.encoder.relativeMm = 0;
      state.encoder.demoDirection = 1;
      state.encoder.demoPauseUntil = 0;
      state.liveModelViewer?.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
    } else if (state.encoder.mode === "connecting" && demoSession) {
      state.encoder.lastDemoRaw = encoderRawForPosition(startMm);
      state.encoder.raw = state.encoder.lastDemoRaw;
      state.encoder.angleDeg = normalizeAngle(
        state.encoder.raw / Math.max(1, state.encoder.countsPerRev) * 360
      );
      state.encoder.previousPosition = null;
      state.encoder.positionMm = startMm;
      state.encoder.relativeMm = 0;
      state.encoder.demoDirection = 1;
      state.encoder.demoPauseUntil = 0;
      state.liveModelViewer?.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
    } else if (canLockEsp) {
      state.esp.baselineValueMm = state.esp.lastValueMm;
      state.esp.relativeMm = 0;
      state.encoder.relativeMm = 0;
      state.encoder.previousPosition = null;
      state.encoder.positionMm = startMm;
      state.encoder.raw = 0;
      state.encoder.angleDeg = 0;
      state.liveModelViewer?.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
      addEvent(
        "encoder",
        "起始读数已锁定",
        `设备值 ${state.esp.lastValueMm.toFixed(3)} mm → 主尺 ${startMm.toFixed(3)} mm`
      );
    } else if (canLockRaw) {
      state.encoder.mainScaleBaselineRaw = state.encoder.lastHardwareRaw;
      state.encoder.relativeMm = 0;
      state.encoder.previousPosition = null;
      state.encoder.positionMm = startMm;
      state.encoder.raw = 0;
      state.encoder.angleDeg = 0;
      state.liveModelViewer?.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
      addEvent(
        "encoder",
        "起始读数已锁定",
        `当前设备值设为 0 点 · 主尺 ${startMm.toFixed(3)} mm`
      );
    } else {
      state.encoder.mainScaleBaselineRaw = null;
      state.encoder.lastHardwareRaw = null;
      state.encoder.relativeMm = 0;
      state.esp.baselineValueMm = null;
      state.esp.relativeMm = 0;
      if (["esp", "ws", "serial"].includes(state.encoder.mode)) {
        state.encoder.previousPosition = null;
        state.encoder.positionMm = startMm;
        state.encoder.raw = 0;
        state.encoder.angleDeg = 0;
      }
    }
    if (demoSession) setDemoMotion(false);

    updateEncoderUI();
    updateEspSyncUI();
    if (state.ringSummary.rows.length) renderRingSummary();
    if (announce) {
      toast(
        demoSession || canLockEsp || canLockRaw ? "起始位置已同步" : "起始读数已设置",
        demoSession
          ? `演示已停在 ${startMm.toFixed(3)} mm；点击“继续演示”后从该位置开始运动。`
          : canLockEsp || canLockRaw
          ? `当前设备值已设为 0 点，读数从 ${startMm.toFixed(3)} mm 开始累加。`
          : `连接设备后，首帧将自动设为 0 点。`
      );
    }
    return startMm;
  }

  function updateEspSyncUI() {
    const dot = $("espSyncDot");
    if (!dot) return;
    dot.classList.toggle("online", state.esp.status === "online");
    dot.classList.toggle(
      "connecting",
      state.esp.status === "connecting" || state.esp.status === "waiting"
    );
    dot.classList.toggle("error", state.esp.status === "error");
    const statusText = {
      online: "数据同步中",
      connecting: "正在连接装置",
      waiting: "等待首帧数据",
      error: "连接中断，等待重试",
      idle: "等待连接"
    }[state.esp.status] || "等待连接";
    $("espSyncStatus").textContent = statusText;
    $("espSyncAddress").textContent = state.esp.base
      ? `${state.esp.base} · 起点 ${configuredStartPositionMm().toFixed(3)} mm`
      : "输入 ESP8266 地址开始同步";
    $("espConnectLabel").textContent = state.esp.source ? "断开" : "连接";
    updateStartPositionUI();
  }

  function disconnectEspStream(manual = true) {
    if (state.esp.reconnectTimer) {
      window.clearTimeout(state.esp.reconnectTimer);
      state.esp.reconnectTimer = null;
    }
    if (state.esp.source) {
      state.esp.source.close();
      state.esp.source = null;
    }
    state.esp.status = "idle";
    if (manual) {
      state.encoder.mode = "demo";
      state.encoder.lastDemoRaw = encoderRawForPosition(state.encoder.positionMm);
      updateEncoderUI();
      addEvent("encoder", "ESP8266 同步已断开", "平台回到模拟编码器");
    }
    updateEspSyncUI();
  }

  function handleEspReading(message) {
    const value = Number(message.value ?? message.positionMm ?? message.mm);
    if (!Number.isFinite(value)) return;
    const now = Date.now();
    const previousLocalAt = state.esp.lastReceivedAt;
    state.esp.previousValueMm = state.esp.lastValueMm;
    state.esp.lastValueMm = value;
    state.esp.lastDeviceTimeMs = Number.isFinite(Number(message.time))
      ? Number(message.time)
      : null;
    state.esp.lastReceivedAt = now;
    state.esp.sampleCount += 1;
    state.esp.status = "online";
    const establishingBaseline = state.esp.baselineValueMm == null;
    if (establishingBaseline) {
      state.esp.baselineValueMm = value;
      state.esp.modelAnchorMm = configuredStartPositionMm();
      state.liveModelViewer?.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
    }

    const direction = settings.direction === -1 ? -1 : 1;
    const relativeMm = establishingBaseline ? 0 : (value - state.esp.baselineValueMm) * direction;
    state.esp.relativeMm = relativeMm;
    state.encoder.previousPosition = establishingBaseline ? null : state.encoder.positionMm;
    state.encoder.mode = "esp";
    state.encoder.syncValueMm = value;
    state.encoder.deviceTimeMs = state.esp.lastDeviceTimeMs;
    state.encoder.relativeMm = relativeMm;
    state.encoder.positionMm = clamp(
      state.esp.modelAnchorMm + relativeMm,
      MEASUREMENT_MIN_MM,
      MEASUREMENT_MAX_MM
    );
    state.encoder.raw = relativeMm
      / Math.max(0.0001, state.encoder.pitchMm)
      * Math.max(1, state.encoder.countsPerRev);
    state.encoder.angleDeg = normalizeAngle(
      relativeMm
      / Math.max(0.0001, state.encoder.pitchMm)
      * 360
    );
    state.encoder.latencyMs = previousLocalAt == null
      ? 0
      : clamp(now - previousLocalAt, 0, 10000);
    if (previousLocalAt != null && now > previousLocalAt) {
      state.encoder.sampleRate = clamp(1000 / (now - previousLocalAt), 0.1, 200);
    }
    if (state.esp.sampleCount === 1) {
      addEvent(
        "encoder",
        "ESP8266 数据流已接入",
        `${state.esp.base}/events · 首帧 ${value.toFixed(3)} mm 设为 0 点 · 主尺 ${configuredStartPositionMm().toFixed(3)} mm`
      );
    }
    updateEncoderUI();
    updateEspSyncUI();
    if (state.ringSummary.rows.length) renderRingSummary();
  }

  function connectEspStream(notify = true) {
    if (state.esp.source) {
      disconnectEspStream(true);
      if (notify) toast("ESP8266 已断开", "已停止同步并回到模拟编码器。");
      return;
    }
    let base;
    try {
      base = normalizeEspAddress($("espHostInput").value);
    } catch (error) {
      state.esp.status = "error";
      state.esp.base = "";
      updateEspSyncUI();
      if (notify) toast("装置地址无效", error.message, "error");
      return;
    }

    disconnectEspStream(false);
    closeWebSocket(false);
    if (state.serial.active) closeSerial(false);
    state.esp.base = base;
    state.esp.status = "connecting";
    state.esp.sampleCount = 0;
    state.esp.baselineValueMm = null;
    state.esp.modelAnchorMm = configuredStartPositionMm();
    state.esp.previousValueMm = null;
    state.esp.lastValueMm = null;
    state.encoder.mode = "connecting";
    state.encoder.mainScaleBaselineRaw = null;
    state.encoder.lastHardwareRaw = null;
    state.encoder.relativeMm = 0;
    state.encoder.raw = 0;
    state.encoder.angleDeg = 0;
    state.encoder.previousPosition = null;
    state.encoder.positionMm = configuredStartPositionMm();
    saveJson(ESP_STORAGE_KEY, base);
    $("espHostInput").value = base;
    updateEspSyncUI();
    updateEncoderUI();

    let source;
    try {
      source = new EventSource(`${base}/events`);
    } catch (error) {
      state.esp.status = "error";
      state.encoder.mode = "demo";
      updateEspSyncUI();
      updateEncoderUI();
      if (notify) toast("无法建立同步连接", error.message, "error");
      return;
    }
    state.esp.source = source;
    source.onopen = () => {
      state.esp.status = state.esp.sampleCount ? "online" : "waiting";
      if (state.encoder.mode === "connecting") state.encoder.mode = "esp";
      updateEspSyncUI();
      updateEncoderUI();
      if (notify) toast("ESP8266 已连接", `正在接收 ${base}/events 实时数据。`);
    };
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "data" || message.value != null) {
          handleEspReading(message);
        }
      } catch (error) {
        console.warn("ESP8266 SSE 数据格式无效:", event.data, error);
      }
    };
    source.onerror = () => {
      state.esp.status = "error";
      if (state.esp.sampleCount === 0) {
        state.encoder.mode = "demo";
      }
      updateEspSyncUI();
      updateEncoderUI();
    };
  }

  function initializeEspAddress() {
    const saved = loadJson(ESP_STORAGE_KEY, "");
    const query = new URLSearchParams(window.location.search);
    const address = query.get("esp") || query.get("host") || saved || "";
    $("espHostInput").value = address;
    if (address) {
      try {
        state.esp.base = normalizeEspAddress(address);
      } catch (error) {
        state.esp.base = "";
      }
    }
    updateEspSyncUI();
    updateStartPositionUI();
    $("startPositionInput").value = configuredStartPositionMm().toFixed(3);
  }

  function closeWebSocket(manual = false) {
    if (state.wsReconnectTimer) {
      window.clearTimeout(state.wsReconnectTimer);
      state.wsReconnectTimer = null;
    }
    if (state.ws) {
      const socket = state.ws;
      state.ws = null;
      try {
        socket.close();
      } catch (error) {
        console.warn(error);
      }
    }
    if (manual && state.encoder.mode !== "serial") {
      state.encoder.mode = "demo";
      state.encoder.lastDemoRaw = encoderRawForPosition(state.encoder.positionMm);
      updateEncoderUI();
      addEvent("encoder", "编码器已断开", "已回到模拟信号");
    }
  }

  function connectWebSocket() {
    const url = ($("wsUrlInput").value || settings.wsUrl).trim();
    if (!url) {
      toast("缺少 WebSocket 地址", "请输入编码器桥接服务地址。", "warn");
      return;
    }
    closeWebSocket(false);
    if (state.serial.active) closeSerial(false);
    if (state.esp.source) disconnectEspStream(false);
    settings.wsUrl = url;
    saveJson(SETTINGS_KEY, settings);
    state.encoder.mode = "connecting";
    state.encoder.mainScaleBaselineRaw = null;
    state.encoder.lastHardwareRaw = null;
    state.encoder.relativeMm = 0;
    state.encoder.raw = 0;
    state.encoder.angleDeg = 0;
    state.encoder.previousPosition = null;
    state.encoder.positionMm = configuredStartPositionMm();
    updateEncoderUI();
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      state.encoder.mode = "demo";
      updateEncoderUI();
      toast("WebSocket 地址无效", error.message, "error");
      return;
    }
    state.ws = socket;
    socket.addEventListener("open", () => {
      state.encoder.mode = "ws";
      state.encoder.lastTimestamp = Date.now();
      setStatusChip("encoder", "online", "WebSocket 编码器在线");
      updateEncoderUI();
      addEvent("encoder", "WebSocket 编码器已连接", url);
      toast("装置已连接", "编码器数据将通过 WebSocket 实时进入平台。");
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleHardwareMessage(payload);
      } catch (error) {
        const raw = Number(String(event.data).trim());
        if (Number.isFinite(raw)) handleEncoderPayload({ raw });
      }
    });
    socket.addEventListener("close", () => {
      if (state.ws !== socket) return;
      state.ws = null;
      if (state.encoder.mode !== "serial") {
        state.encoder.mode = "demo";
        state.encoder.lastDemoRaw = encoderRawForPosition(state.encoder.positionMm);
        updateEncoderUI();
        addEvent("warning", "编码器连接已断开", "平台已回到模拟信号", { severity: "warn" });
      }
    });
    socket.addEventListener("error", () => {
      if (state.encoder.mode === "connecting") {
        state.encoder.mode = "demo";
        updateEncoderUI();
        toast("编码器连接失败", "请确认桥接服务已启动并监听对应端口。", "error");
      }
    });
  }

  function handleHardwareMessage(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "capture") {
      const side = payload.side === "right" ? "right" : "left";
      captureMeasurement(side, { hardware: true });
      return;
    }
    if (payload.type === "encoder" || payload.raw != null || payload.count != null || payload.angle != null) {
      handleEncoderPayload(payload);
    }
  }

  function handleEncoderPayload(payload) {
    const raw = numberOr(
      payload.raw,
      numberOr(payload.count, numberOr(payload.encoder_count, numberOr(payload.value, state.encoder.raw)))
    );
    if (!Number.isFinite(raw)) return;

    const countsPerRev = Math.max(1, numberOr(payload.countsPerRev, numberOr(payload.counts_per_rev, state.encoder.countsPerRev)));
    const pitchMm = Math.max(0.0001, state.encoder.pitchMm);
    const direction = settings.direction === -1 ? -1 : 1;
    const enteringLiveMode =
      state.encoder.mode === "demo"
      || state.encoder.mode === "connecting"
      || state.encoder.mainScaleBaselineRaw == null;
    const previousPosition = enteringLiveMode ? null : state.encoder.positionMm;

    state.encoder.mode = payload.transport === "serial" ? "serial" : "ws";
    state.encoder.lastHardwareRaw = raw;
    state.encoder.countsPerRev = countsPerRev;
    state.encoder.syncValueMm = null;
    state.encoder.deviceTimeMs = null;

    if (enteringLiveMode) {
      state.encoder.mainScaleBaselineRaw = raw;
      state.encoder.relativeMm = 0;
      state.encoder.raw = 0;
      state.encoder.angleDeg = 0;
      state.encoder.previousPosition = null;
      state.encoder.positionMm = configuredStartPositionMm();
      state.liveModelViewer?.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
    } else {
      const relativeRaw = raw - state.encoder.mainScaleBaselineRaw;
      const relativeMm = relativeRaw / countsPerRev * pitchMm * direction;
      const signedRaw = relativeRaw * direction;
      state.encoder.relativeMm = relativeMm;
      state.encoder.raw = signedRaw;
      state.encoder.angleDeg = normalizeAngle(relativeMm / pitchMm * 360);
      state.encoder.previousPosition = previousPosition;
      state.encoder.positionMm = clamp(
        configuredStartPositionMm() + relativeMm,
        MEASUREMENT_MIN_MM,
        MEASUREMENT_MAX_MM
      );
    }

    const timestamp = parseTimestamp(payload.timestamp || payload.ts);
    state.encoder.latencyMs = Number.isFinite(timestamp)
      ? clamp(Date.now() - timestamp, 0, 5000)
      : 0;
    if (payload.sampleRate || payload.sample_rate) {
      state.encoder.sampleRate = numberOr(payload.sampleRate, numberOr(payload.sample_rate, state.encoder.sampleRate));
    }
    if (enteringLiveMode) {
      addEvent(
        "encoder",
        "编码器零点已建立",
        `当前设备值 ${Math.round(raw)} 设为 0 点 · 起始读数 ${configuredStartPositionMm().toFixed(3)} mm`
      );
    }
    updateEncoderUI();
  }

  async function connectSerial() {
    if (state.serial.active) {
      closeSerial(true);
      return;
    }
    if (!("serial" in navigator)) {
      toast("浏览器不支持串口", "请使用最新版 Chrome 或 Edge，并通过 localhost 打开平台。", "error");
      return;
    }
    try {
      closeWebSocket(false);
      if (state.esp.source) disconnectEspStream(false);
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: numberOr(settings.serialBaud, 115200) });
      state.serial.port = port;
      state.serial.active = true;
      state.encoder.mode = "serial";
      state.encoder.mainScaleBaselineRaw = null;
      state.encoder.lastHardwareRaw = null;
      state.encoder.relativeMm = 0;
      state.encoder.raw = 0;
      state.encoder.angleDeg = 0;
      state.encoder.previousPosition = null;
      state.encoder.positionMm = configuredStartPositionMm();
      updateEncoderUI();
      addEvent("encoder", "USB 串口编码器已连接", `Baud ${settings.serialBaud}`);
      toast("串口已连接", "正在读取编码器数据行。");
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      state.serial.reader = reader;
      let buffer = "";
      while (state.serial.active) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          parseSerialLine(line.trim());
        }
      }
    } catch (error) {
      console.error(error);
      if (error.name !== "NotFoundError") {
        toast("串口连接失败", error.message || "请检查端口是否被占用。", "error");
      }
      state.serial.active = false;
      state.encoder.mode = "demo";
      updateEncoderUI();
    }
  }

  function parseSerialLine(line) {
    if (!line) return;
    if (line.startsWith("{")) {
      try {
        handleHardwareMessage(JSON.parse(line));
        return;
      } catch (error) {
        console.warn("Invalid serial JSON:", line);
      }
    }
    const payload = {};
    line.split(/[,\s;]+/).forEach((segment) => {
      const [key, value] = segment.split("=");
      if (value != null) {
        payload[key.trim()] = Number(value);
      }
    });
    if (Object.keys(payload).length) {
      payload.transport = "serial";
      handleEncoderPayload(payload);
      return;
    }
    const numeric = Number(line);
    if (Number.isFinite(numeric)) {
      handleEncoderPayload({ raw: numeric, transport: "serial" });
    }
  }

  async function closeSerial(manual = true) {
    state.serial.active = false;
    try {
      await state.serial.reader?.cancel();
      await state.serial.port?.close();
    } catch (error) {
      console.warn(error);
    }
    state.serial.reader = null;
    state.serial.port = null;
    if (manual) {
      state.encoder.mode = "demo";
      state.encoder.lastDemoRaw = encoderRawForPosition(state.encoder.positionMm);
      updateEncoderUI();
      addEvent("encoder", "串口编码器已断开", "平台回到模拟信号");
    }
  }

  function switchView(viewId) {
    const allowed = ["live", "analysis", "process", "device", "report"];
    if (!allowed.includes(viewId)) return;
    state.view = viewId;
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
    $$(".innovation-embed-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.goView === viewId);
    });
    $$(".app-view").forEach((view) => view.classList.toggle("active", view.id === `view-${viewId}`));
    if (window.location.hash !== `#${viewId}`) {
      history.replaceState(null, "", `#${viewId}`);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (viewId === "analysis") {
      renderAnalysis();
    } else if (viewId === "process") {
      renderFullTimeline();
      renderSnapshots();
      loadBackendSessions(true);
      window.setTimeout(() => renderProcessEncoderMonitor(true), 30);
    } else if (viewId === "report") {
      renderReport();
      addEvent("report", "查看诊断报告", "已按当前测量证据刷新报告", { silent: true });
    } else if (viewId === "device") {
      window.setTimeout(ensureDeviceViewer, 80);
    }
  }

  async function ensureLiveDeviceViewer() {
    if (state.liveModelViewer || state.liveModelLoadStarted) return;
    state.liveModelLoadStarted = true;
    try {
        const module = await import("https://cdn.jsdelivr.net/gh/byyyyy666/newton-rings-virtual-lab@ff615c395bec1a01b4d498024f0bffd7bb31233a/model-viewer.js?v=meshopt-cdn-v10");
      state.liveModelViewer = await module.initDeviceViewer({
        canvas: $("liveDeviceCanvas"),
        autoRotateDefault: false,
        sceneBackground: "#cbd7dd",
        sceneFog: "#cbd7dd",
        groundColor: "#c8d2d8",
        gridMajorColor: "#91a6b1",
        gridMinorColor: "#afbec5",
        onManualMove: handleLiveModelManualMove,
        onReady: (meta) => {
          $("liveModelLoader").classList.add("hidden");
          $("liveModelState").textContent = "LIVE SYNC";
          addEvent(
            "archive",
            "整体装置模型已载入",
            `${meta.meshes} 个网格 · ${meta.triangles.toLocaleString("en-US")} 个三角面`,
            { silent: true }
          );
        }
      });
        calibrateLiveModelScale();
        syncDemoVisuals();
      window.__nrfusionLiveViewer = state.liveModelViewer;
    } catch (error) {
      console.error(error);
      $("liveModelLoader").innerHTML = `<strong>整体装置载入失败</strong><small>${escapeHtml(error.message || "请通过本地服务器打开平台")}</small>`;
      $("liveModelState").textContent = "MODEL ERROR";
    }
  }

  function calibrateLiveModelScale() {
    if (!state.liveModelViewer) return;
    state.liveModelViewer.setStageOrigin?.(MODEL_SCALE_ZERO_MM);
    const readingMm = clamp(
      state.encoder.positionMm,
      MEASUREMENT_MIN_MM,
      MEASUREMENT_MAX_MM
    );
    state.liveModelViewer.setReadout?.({
      angleDeg: normalizeAngle(
        (readingMm - MEASUREMENT_MIN_MM)
        / Math.max(0.0001, state.encoder.pitchMm)
        * 360
      ),
      positionMm: readingMm,
      angleOffsetDeg: numberOr(settings.drumZeroAngle, 0)
    });
  }

  function handleLiveModelManualMove({ phase, deltaMm }) {
    if (phase === "end") {
      if (state.encoder.mode === "demo") {
        addEvent(
          "encoder",
          "三维鼓轮手动操作",
          `当前位置 ${state.encoder.positionMm.toFixed(3)} mm`,
          { silent: true }
        );
      }
      if (
        EMBED_MODE
        && state.session.status === "active"
        && !state.demoPausedByUser
      ) {
        setDemoMotion(true);
      }
      return;
    }
    if (phase === "start") {
      if (state.encoder.mode !== "demo") {
        toast("当前为硬件同步模式", "三维鼓轮拖动只用于模拟操作，不会反向驱动编码器。", "warn");
        return;
      }
      setDemoMotion(false);
      return;
    }
    if (state.encoder.mode !== "demo" || !Number.isFinite(deltaMm)) return;

    const countsPerRev = Math.max(1, numberOr(settings.countsPerRev, 8192));
    const pitchMm = Math.max(0.0001, numberOr(settings.pitchMm, 0.5));
    const direction = settings.direction === -1 ? -1 : 1;
    const rawDelta = deltaMm / pitchMm * countsPerRev * direction;
    const { min, max } = demoRawRange();
    applyDemoRaw(clamp(state.encoder.raw + rawDelta, min, max));
  }

  async function ensureDeviceViewer() {
    if (state.modelViewer || state.modelLoadStarted) return;
    state.modelLoadStarted = true;
    try {
      const module = await import("https://cdn.jsdelivr.net/gh/byyyyy666/newton-rings-virtual-lab@ff615c395bec1a01b4d498024f0bffd7bb31233a/model-viewer.js?v=meshopt-cdn-v10");
      state.modelViewer = await module.initDeviceViewer({
        canvas: $("deviceCanvas"),
        onReady: (meta) => {
          $("modelLoader").classList.add("hidden");
          addEvent("archive", "装置数字模型已载入", `${meta.meshes} 个网格 · ${meta.triangles.toLocaleString("en-US")} 个三角面`, { silent: true });
        },
        onError: (error) => {
          console.error(error);
          $("modelLoader").innerHTML = `<strong>装置模型载入失败</strong><small>${escapeHtml(error.message || "请通过本地 HTTP 服务器打开平台")}</small>`;
        }
      });
    } catch (error) {
      console.error(error);
      $("modelLoader").innerHTML = `<strong>装置模型载入失败</strong><small>${escapeHtml(error.message || "模型模块不可用")}</small>`;
    }
  }

  function bindNavigation() {
    $$(".nav-item").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });
    $$("[data-go-view]").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.goView));
    });
  }

  function bindLiveControls() {
    $("cameraToggleBtn").addEventListener("click", toggleCamera);
    $("autoVisionBtn").addEventListener("click", runVisionAnalysis);
    $("connectEspBtn").addEventListener("click", () => connectEspStream(true));
    $("espHostInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        connectEspStream(true);
      }
    });
    $("setStartPositionBtn").addEventListener("click", () => {
      setStartPosition($("startPositionInput").value);
    });
    $("startPositionInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        setStartPosition(event.currentTarget.value);
        event.currentTarget.blur();
      }
    });
    $("recordCurrentRingBtn").addEventListener("click", () => {
      resetRingSequence({ announce: true });
      persistSession(true);
    });
    $("ringSummaryBody").addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-ring]");
      if (!deleteButton) return;
      event.preventDefault();
      event.stopPropagation();
      deleteRingRecord(deleteButton.dataset.deleteRing);
    });
    $("clearRingSummaryBtn").addEventListener("click", clearRingSummary);
    $("overlayToggleBtn").addEventListener("click", toggleOverlay);
    $("freezeBtn").addEventListener("click", toggleFreeze);
    $("captureLeftBtn").addEventListener("click", () => captureMeasurement("left"));
    $("captureRightBtn").addEventListener("click", () => captureMeasurement("right"));
    $("leftSlot").addEventListener("click", () => captureMeasurement("left"));
    $("rightSlot").addEventListener("click", () => captureMeasurement("right"));
    $("ringMinusBtn").addEventListener("click", () => setRingStartOrder(state.ringSequence.startOrder - 1));
    $("ringPlusBtn").addEventListener("click", () => setRingStartOrder(state.ringSequence.startOrder + 1));
    $("ringOrderInput").addEventListener("change", (event) => {
      event.target.value = String(setRingStartOrder(event.target.value));
      renderCaptureSlots();
    });
    $("zeroEncoderBtn").addEventListener("click", () => {
      if (["esp", "ws", "serial"].includes(state.encoder.mode)) {
        setStartPosition(MEASUREMENT_MIN_MM, { announce: false });
        toast("起始位置已归零", "当前编码器帧已设为 0 点，主尺读数归零。");
      } else {
        settings.zeroOffsetMm = -state.encoder.direction * (state.encoder.raw / state.encoder.countsPerRev) * state.encoder.pitchMm;
        state.encoder.zeroOffsetMm = settings.zeroOffsetMm;
        state.encoder.previousPosition = state.encoder.positionMm;
        state.encoder.positionMm = 0;
        saveJson(SETTINGS_KEY, settings);
        addEvent("encoder", "编码器零点已记录", `raw ${Math.round(state.encoder.raw)} → 0.0000 mm`);
        toast("零点已记录", "后续位置读数从当前编码器计数开始换算。");
      }
      updateEncoderUI();
      renderRingSummary();
    });
    $("connectEncoderBtn").addEventListener("click", () => openSettings("encoder"));
    $("encoderSettingsBtn").addEventListener("click", () => openSettings("encoder"));
    $("cameraStatusChip").addEventListener("click", () => openSettings("camera"));
    $("encoderStatusChip").addEventListener("click", () => openSettings("encoder"));
    $("visionStatusChip").addEventListener("click", () => openSettings("vision"));
    $("saveSessionBtn").addEventListener("click", () => {
      persistSession(true);
      toast("会话已保存", "当前测点、事件与设置已写入本机浏览器。");
    });
    $("loadDemoBtn").addEventListener("click", loadDemoData);
    $("sessionPauseBtn").addEventListener("click", toggleSessionPause);
    $("newSessionBtn").addEventListener("click", openSessionDialog);
    $("studentChip").addEventListener("click", openSessionDialog);
    $("sessionSettingsBtn").addEventListener("click", openSessionDialog);
    $("liveDemoMotionBtn").addEventListener("click", () => {
      const nextMotion = !state.demoMotion;
      setDemoMotion(nextMotion, true);
      state.demoPausedByUser = !nextMotion;
      addEvent(
        "reset",
        state.demoMotion ? "三维联动演示已继续" : "三维联动演示已暂停",
        state.demoMotion ? "鼓轮与显微组件恢复自动演示" : "编码器与三维模型保持在当前状态"
      );
    });
    $("liveModelDrumBtn").addEventListener("click", () => {
      state.liveModelViewer?.focusDrum?.();
    });
    $("liveModelRotateBtn").addEventListener("click", () => {
      const active = state.liveModelViewer?.toggleAutoRotate?.();
      setButtonActive($("liveModelRotateBtn"), Boolean(active));
    });
    $("liveModelResetBtn").addEventListener("click", () => {
      state.liveModelViewer?.reset?.();
      setButtonActive($("liveModelRotateBtn"), false);
    });

    const encoderCanvas = $("encoderDial");
    let dragging = false;
    let lastPointerAngle = 0;
    const pointerAngle = (event) => {
      const rect = encoderCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      return normalizeAngle(Math.atan2(y, x) * 180 / Math.PI + 90);
    };
    encoderCanvas.addEventListener("pointerdown", (event) => {
      if (state.encoder.mode !== "demo") return;
      dragging = true;
      lastPointerAngle = pointerAngle(event);
      setDemoMotion(false);
      encoderCanvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    encoderCanvas.addEventListener("pointermove", (event) => {
      if (!dragging || state.encoder.mode !== "demo") return;
      const next = pointerAngle(event);
      let delta = next - lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      lastPointerAngle = next;
      const nextRaw = state.encoder.lastDemoRaw + delta / 360 * state.encoder.countsPerRev;
      applyDemoRaw(nextRaw);
      event.preventDefault();
    });
    const endDrag = () => {
      dragging = false;
      if (
        EMBED_MODE
        && state.session.status === "active"
        && !state.demoPausedByUser
      ) {
        setDemoMotion(true);
      }
    };
    encoderCanvas.addEventListener("pointerup", endDrag);
    encoderCanvas.addEventListener("pointercancel", endDrag);
  }

  function bindAnalysisControls() {
    $("recalculateBtn").addEventListener("click", () => {
      renderAnalysis();
      renderQuickDiagnosis();
      renderReport();
      addEvent("fit", "重新计算完成", "已使用当前参数刷新拟合与诊断");
      toast("计算完成", "拟合结果与诊断已刷新。");
    });
    $("exportCsvBtn").addEventListener("click", exportPairsCsv);
    $("exportJsonBtn").addEventListener("click", exportSessionJson);
    $("exportSessionBtn").addEventListener("click", exportSessionJson);
    $("wavelengthInput").addEventListener("change", (event) => {
      state.session.wavelengthNm = Math.max(1, numberOr(event.target.value, 589.3));
      renderAll();
      persistSession(true);
    });
    $("referenceRInput").addEventListener("change", (event) => {
      state.session.referenceR = Math.max(0.001, numberOr(event.target.value, 1));
      renderAll();
      persistSession(true);
    });
    $("fitModeSelect").addEventListener("change", (event) => {
      state.session.fitMode = event.target.value;
      renderAll();
      persistSession(true);
    });
    $("residualThresholdInput").addEventListener("change", (event) => {
      state.session.residualThreshold = clamp(numberOr(event.target.value, 2.5), 0.5, 10);
      renderAll();
      persistSession(true);
    });
    $("studentCompareBody").addEventListener("change", (event) => {
      const input = event.target.closest("[data-student-order][data-student-side]");
      if (!input) return;
      setStudentReading(
        input.dataset.studentOrder,
        input.dataset.studentSide,
        input.value
      );
      updateStudentComparisonRow(input.dataset.studentOrder);
      renderReport();
      persistSession(true);
    });
  }

  function bindReportControls() {
    $("refreshReportBtn").addEventListener("click", () => {
      renderReport();
      addEvent("report", "诊断报告已刷新", "重新评估当前数据证据");
      toast("报告已刷新", "诊断内容基于当前数据重新生成。");
    });
    $("saveStudentComparisonBtn").addEventListener("click", () => {
      const resultValue = $("studentResultInput").value.trim();
      const uncertaintyValue = $("studentUncertaintyInput").value.trim();
      if (!resultValue) {
        state.session.studentResultR = null;
      } else {
        const parsed = Number(resultValue);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          toast("学生结果无效", "请输入大于 0 的曲率半径。", "warn");
          return;
        }
        state.session.studentResultR = parsed;
      }
      state.session.studentUncertaintyR = uncertaintyValue === "" ? null : Math.max(0, numberOr(uncertaintyValue, 0));
      state.session.studentMethod = $("studentMethodInput").value;
      renderReport();
      persistSession(true);
      addEvent(
        "report",
        state.session.studentResultR == null ? "已清除学生核算结果" : "学生核算结果已录入",
        state.session.studentResultR == null
          ? "诊断报告不再进行学生结果对照"
          : `R = ${state.session.studentResultR.toFixed(3)} m · ${state.session.studentMethod}`
      );
      toast("学生结果已更新", "平台已重新计算自动结果与学生核算的差值。");
    });
    $("printReportBtn").addEventListener("click", () => window.print());
    $("downloadReportBtn").addEventListener("click", downloadReport);
  }

  function bindProcessControls() {
    $("pauseEncoderHistoryBtn").addEventListener("click", toggleEncoderMonitorPause);
    $("clearEncoderHistoryBtn").addEventListener("click", clearEncoderMonitor);
    $("exportEncoderCsvBtn").addEventListener("click", exportEncoderMonitorCsv);
    $("exportEncoderSnapshotBtn").addEventListener("click", exportEncoderMonitorSnapshot);
    $("clearTraceBtn").addEventListener("click", () => {
      if (!window.confirm("清空当前操作时间线？测量数据不会删除。")) return;
      state.session.events = [];
      addEvent("reset", "操作时间线已清空", "配对测量数据保持不变");
      renderAll();
    });
    $("editSessionMetaBtn").addEventListener("click", openSessionDialog);
    $("refreshArchiveBtn").addEventListener("click", () => loadBackendSessions(false));
    $("backendArchiveList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-load-session]");
      if (button) loadBackendSession(button.dataset.loadSession);
    });
  }

  function bindModelControls() {
    $("modelResetBtn").addEventListener("click", () => state.modelViewer?.reset?.());
    $("modelRotateBtn").addEventListener("click", () => {
      const active = state.modelViewer?.toggleAutoRotate?.();
      setButtonActive($("modelRotateBtn"), Boolean(active));
    });
    $("modelLampBtn").addEventListener("click", () => {
      state.modelViewer?.focusLamp?.();
      toast("已聚焦钠光灯", "U 形放电灯管位于整机左前方。");
    });
  }

  function bindDialogs() {
    $("openSettingsBtn").addEventListener("click", () => openSettings());
    $("openHelpBtn").addEventListener("click", () => $("helpDialog").showModal());
    $("cameraStatusChip").dataset.openSettings = "camera";
    $("encoderStatusChip").dataset.openSettings = "encoder";
    $("visionStatusChip").dataset.openSettings = "vision";

    $("settingsForm").addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault();
      applySettingsFromInputs();
      $("settingsDialog").close();
    });
    $("sessionForm").addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault();
      beginNewSession();
      $("sessionDialog").close();
    });
    $("wsConnectBtn").addEventListener("click", connectWebSocket);
    $("serialConnectBtn").addEventListener("click", connectSerial);
    $("testVisionBtn").addEventListener("click", testVisionService);
    $("saveSettingsBtn").addEventListener("click", () => {
      // The form submit handler performs the actual save.
    });
  }

  function bindKeyboard() {
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const isEditing = target.matches?.("input, select, textarea") || target.isContentEditable;
      if (isEditing) return;
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        captureMeasurement("left");
      } else if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        captureMeasurement("right");
      } else if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        runVisionAnalysis();
      }
    });
  }

  function startTicker() {
    window.setInterval(() => {
      if (state.session.status === "active") {
        state.session.elapsedMs += 1000;
        $("sessionTimer").textContent = formatDuration(state.session.elapsedMs);
        if (Math.floor(state.session.elapsedMs / 1000) % 12 === 0) {
          persistSession(true);
        }
      }
    }, 1000);
  }

  function syncInputsFromSession() {
    $("wavelengthInput").value = String(state.session.wavelengthNm);
    $("referenceRInput").value = String(state.session.referenceR);
    $("fitModeSelect").value = state.session.fitMode;
    $("residualThresholdInput").value = String(state.session.residualThreshold);
  }

  function updateCameraStatus() {
    updateOpticsUi();
    setButtonActive($("cameraToggleBtn"), state.camera.active);
  }

  function updateLayoutDiagnostics() {
    const root = document.documentElement;
    document.body.dataset.viewport = `${window.innerWidth}x${window.innerHeight}`;
    document.body.dataset.horizontalOverflow = root.scrollWidth > root.clientWidth ? "true" : "false";
  }

  function init() {
    if (window.lucide) {
      window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
    }
    bindNavigation();
    bindLiveControls();
    bindAnalysisControls();
    bindReportControls();
    bindProcessControls();
    bindModelControls();
    bindDialogs();
    bindKeyboard();
    initializeEspAddress();
    initializeDemoVideo();
    syncInputsFromSession();
    const demoMode = new URLSearchParams(window.location.search).get("demo");
    if (demoMode === "30") {
      loadDemoData({ force: true, notify: false });
    }
    renderAll();
    syncOverlayVisibility();
    if (EMBED_MODE) {
      state.session.status = "active";
      state.encoder.mode = "demo";
      setDemoMotion(true);
      state.camera.demoVideo?.play().catch(() => {});
      drawOptics(performance.now());
    }
    updateCameraStatus();
    updateOpticsUi();
    drawGrayProfileChart();
    updateLayoutDiagnostics();
    window.addEventListener("resize", updateLayoutDiagnostics);
    window.addEventListener("resize", () => {
      if (state.view === "process") {
        renderProcessEncoderMonitor(true);
      }
    });
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(ensureLiveDeviceViewer, { timeout: 1600 });
    } else {
      window.setTimeout(ensureLiveDeviceViewer, 500);
    }
    startVisionInterval();
    startTicker();
    requestAnimationFrame(animationLoop);
    if (!storedSession) {
      persistSession(true);
    }
    window.addEventListener("beforeunload", () => {
      persistSession(true);
      beaconSession();
    });
    window.addEventListener("hashchange", () => {
      const requested = window.location.hash.replace(/^#/, "");
      if (requested && requested !== state.view) switchView(requested);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        renderAll();
      }
    });
    const initialView = window.location.hash.replace(/^#/, "");
    if (["analysis", "process", "device", "report"].includes(initialView)) {
      window.setTimeout(() => switchView(initialView), 0);
    }
    window.setTimeout(() => {
      if (state.session.demo) {
        toast("演示会话已载入", "可在“装置模型”查看整体模型，或连接真实编码器与摄像头开始实采。");
      }
    }, 900);
    if ($("espHostInput").value.trim()) {
      window.setTimeout(() => connectEspStream(false), 700);
    }
    probePlatformBackend();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
