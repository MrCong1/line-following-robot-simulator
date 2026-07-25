"use client";

import { RotateCcw, Play, Pause } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type TrackName = "infinity" | "circle" | "oval" | "square";

type RobotState = {
  x: number;
  y: number;
  angle: number;
  progress: number;
  lateralOffset: number;
  headingError: number;
  yawRate: number;
  lastError: number;
  lastDirection: number;
  integral: number;
  leftVelocity: number;
  rightVelocity: number;
};

type Telemetry = {
  error: number;
  pTerm: number;
  iTerm: number;
  dTerm: number;
  leftPwm: number;
  rightPwm: number;
  correction: number;
  pattern: string;
  lineState: string;
  lastDirection: number;
  sensors: [boolean, boolean, boolean];
  status: string;
};

type Point = {
  x: number;
  y: number;
};

type PathData = {
  points: Point[];
  lengths: number[];
  totalLength: number;
};

const ARENA_WIDTH = 980;
const ARENA_HEIGHT = 620;
const MAX_PWM = 255;
const SENSOR_OFFSET = 46;
const SENSOR_SPACING = 22;
const HISTORY_SIZE = 90;
const LINE_WIDTH = 18;
const SENSOR_TRIGGER_MARGIN = 3.5;
const MOTOR_DEADBAND_PWM = 32;
const MOTOR_RESPONSE_TIME = 0.045;
const MAX_WHEEL_SPEED = 220;
const SIM_WHEEL_BASE = 58;
const SEARCH_PWM_DELTA = 55;
const TRAIL_SIZE = 240;
const CONTROL_AGGRESSIVENESS = 1.12;
const KP_OSCILLATION_START = 28;

const initialTelemetry: Telemetry = {
  error: 0,
  pTerm: 0,
  iTerm: 0,
  dTerm: 0,
  leftPwm: 0,
  rightPwm: 0,
  correction: 0,
  pattern: "000",
  lineState: "Ready",
  lastDirection: 1,
  sensors: [false, false, false],
  status: "San sang",
};

const trackOptions: Array<{ label: string; value: TrackName }> = [
  { label: "Infinity", value: "infinity" },
  { label: "Circle", value: "circle" },
  { label: "Oval", value: "oval" },
  { label: "Square", value: "square" },
];

const chartConfigs = [
  { title: "ERROR (PV)", color: "#5bc8ff", range: 3.2, className: "chart-blue" },
  { title: "P-TERM", color: "#ff4f6b", range: 60, className: "chart-red" },
  { title: "I-TERM", color: "#5bd194", range: 10, className: "chart-green" },
  { title: "D-TERM", color: "#ffb43f", range: 60, className: "chart-yellow" },
];

const sensorStateRows = [
  { pattern: "010", sensor: "Center sensor on line", error: "0", action: "Go straight" },
  { pattern: "110", sensor: "Line is slightly left", error: "-1.5", action: "Turn left gently" },
  { pattern: "100", sensor: "Line is far left", error: "-3", action: "Turn left strongly" },
  { pattern: "011", sensor: "Line is slightly right", error: "+1.5", action: "Turn right gently" },
  { pattern: "001", sensor: "Line is far right", error: "+3", action: "Turn right strongly" },
  { pattern: "111", sensor: "All sensors see line", error: "0", action: "Keep direction" },
  { pattern: "000", sensor: "Line lost", error: "last side", action: "Search using last direction" },
];

const trackStartT: Record<TrackName, number> = {
  infinity: 3.646,
  circle: Math.PI * 1.5,
  oval: Math.PI * 1.5,
  square: 0,
};

const trackCache = new Map<TrackName, Point[]>();
const pathCache = new Map<TrackName, PathData>();

const squareTrack = {
  left: 170,
  right: 810,
  top: 120,
  bottom: 500,
  radius: 82,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function highKpFactor(kp: number) {
  return clamp((kp - KP_OSCILLATION_START) / (100 - KP_OSCILLATION_START), 0, 1);
}

function makeRobot(track: TrackName): RobotState {
  const start = startPose(track);
  return {
    ...start,
    progress: startProgress(track),
    lateralOffset: 0,
    headingError: 0,
    yawRate: 0,
    lastError: 0,
    lastDirection: 1,
    integral: 0,
    leftVelocity: 0,
    rightVelocity: 0,
  };
}

function startProgress(track: TrackName) {
  if (track === "square") {
    return nearestProgressOnPath(track, {
      x: squareTrack.left,
      y: squareTrack.top + squareTrack.radius + 58,
    });
  }
  return (trackStartT[track] / (Math.PI * 2)) * pathData(track).totalLength;
}

function startPose(track: TrackName) {
  return poseFromPath(track, startProgress(track), 0, 0);
}

function curvePoint(track: TrackName, t: number): Point {
  if (track === "circle") {
    return { x: 490 + Math.cos(t) * 215, y: 310 + Math.sin(t) * 215 };
  }
  if (track === "oval") {
    return { x: 490 + Math.cos(t) * 330, y: 310 + Math.sin(t) * 165 };
  }
  if (track === "square") {
    return roundedSquarePoint(t);
  }
  return { x: 490 + Math.sin(t) * 340, y: 310 + Math.sin(t * 2) * 130 };
}

function roundedSquarePoint(t: number): Point {
  const { left, right, top, bottom, radius } = squareTrack;
  const topLength = right - left - radius * 2;
  const sideLength = bottom - top - radius * 2;
  const arcLength = (Math.PI * radius) / 2;
  const totalLength = topLength * 2 + sideLength * 2 + arcLength * 4;
  const normalized = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let distance = (normalized / (Math.PI * 2)) * totalLength;

  if (distance <= topLength) {
    return { x: left + radius + distance, y: top };
  }
  distance -= topLength;

  if (distance <= arcLength) {
    const angle = -Math.PI / 2 + distance / radius;
    return { x: right - radius + Math.cos(angle) * radius, y: top + radius + Math.sin(angle) * radius };
  }
  distance -= arcLength;

  if (distance <= sideLength) {
    return { x: right, y: top + radius + distance };
  }
  distance -= sideLength;

  if (distance <= arcLength) {
    const angle = distance / radius;
    return { x: right - radius + Math.cos(angle) * radius, y: bottom - radius + Math.sin(angle) * radius };
  }
  distance -= arcLength;

  if (distance <= topLength) {
    return { x: right - radius - distance, y: bottom };
  }
  distance -= topLength;

  if (distance <= arcLength) {
    const angle = Math.PI / 2 + distance / radius;
    return { x: left + radius + Math.cos(angle) * radius, y: bottom - radius + Math.sin(angle) * radius };
  }
  distance -= arcLength;

  if (distance <= sideLength) {
    return { x: left, y: bottom - radius - distance };
  }
  distance -= sideLength;

  const angle = Math.PI + distance / radius;
  return { x: left + radius + Math.cos(angle) * radius, y: top + radius + Math.sin(angle) * radius };
}

function drawTrack(ctx: CanvasRenderingContext2D, track: TrackName) {
  ctx.fillStyle = "#f9faf7";
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.strokeStyle = "#050505";
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= 360; i += 1) {
    const p = curvePoint(track, (i / 360) * Math.PI * 2);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
}

function trackPolyline(track: TrackName) {
  const cached = trackCache.get(track);
  if (cached) return cached;
  const samples = Array.from({ length: 721 }, (_, index) => curvePoint(track, (index / 720) * Math.PI * 2));
  trackCache.set(track, samples);
  return samples;
}

function pathData(track: TrackName): PathData {
  const cached = pathCache.get(track);
  if (cached) return cached;
  const points = trackPolyline(track);
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    lengths.push(lengths[index - 1] + Math.hypot(current.x - previous.x, current.y - previous.y));
  }
  const last = points[points.length - 1];
  const first = points[0];
  const totalLength = lengths[lengths.length - 1] + Math.hypot(first.x - last.x, first.y - last.y);
  const data = { points, lengths, totalLength };
  pathCache.set(track, data);
  return data;
}

function samplePath(track: TrackName, progress: number) {
  const data = pathData(track);
  const wrapped = ((progress % data.totalLength) + data.totalLength) % data.totalLength;
  for (let index = 1; index < data.points.length; index += 1) {
    if (wrapped <= data.lengths[index]) {
      const previous = data.points[index - 1];
      const current = data.points[index];
      const segmentLength = data.lengths[index] - data.lengths[index - 1] || 1;
      const ratio = (wrapped - data.lengths[index - 1]) / segmentLength;
      const x = previous.x + (current.x - previous.x) * ratio;
      const y = previous.y + (current.y - previous.y) * ratio;
      const angle = Math.atan2(current.y - previous.y, current.x - previous.x);
      return { x, y, angle };
    }
  }
  const last = data.points[data.points.length - 1];
  const first = data.points[0];
  return { x: first.x, y: first.y, angle: Math.atan2(first.y - last.y, first.x - last.x) };
}

function nearestProgressOnPath(track: TrackName, target: Point) {
  const data = pathData(track);
  let bestProgress = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < data.points.length; index += 1) {
    const current = data.points[index];
    const next = data.points[(index + 1) % data.points.length];
    const vx = next.x - current.x;
    const vy = next.y - current.y;
    const wx = target.x - current.x;
    const wy = target.y - current.y;
    const lengthSq = vx * vx + vy * vy;
    const ratio = lengthSq === 0 ? 0 : clamp((wx * vx + wy * vy) / lengthSq, 0, 1);
    const px = current.x + vx * ratio;
    const py = current.y + vy * ratio;
    const distance = Math.hypot(target.x - px, target.y - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      const segmentStart = index < data.lengths.length ? data.lengths[index] : data.totalLength;
      bestProgress = segmentStart + Math.sqrt(lengthSq) * ratio;
    }
  }
  return bestProgress;
}

function poseFromPath(track: TrackName, progress: number, lateralOffset: number, headingError: number) {
  const sample = samplePath(track, progress);
  const normalX = -Math.sin(sample.angle);
  const normalY = Math.cos(sample.angle);
  const sensorCenter = {
    x: sample.x + normalX * lateralOffset,
    y: sample.y + normalY * lateralOffset,
  };
  const angle = sample.angle + headingError;
  return {
    x: sensorCenter.x - Math.cos(angle) * SENSOR_OFFSET,
    y: sensorCenter.y - Math.sin(angle) * SENSOR_OFFSET,
    angle,
  };
}

function sensorPositions(robot: RobotState): Point[] {
  const forwardX = Math.cos(robot.angle);
  const forwardY = Math.sin(robot.angle);
  const rightX = -Math.sin(robot.angle);
  const rightY = Math.cos(robot.angle);
  return [-SENSOR_SPACING, 0, SENSOR_SPACING].map((offset) => ({
    x: robot.x + forwardX * SENSOR_OFFSET + rightX * offset,
    y: robot.y + forwardY * SENSOR_OFFSET + rightY * offset,
  }));
}

function distanceToSegment(point: Point, a: Point, b: Point) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq === 0 ? 0 : clamp((wx * vx + wy * vy) / lengthSq, 0, 1);
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return Math.hypot(point.x - px, point.y - py);
}

function isSensorOnLine(track: TrackName, point: Point) {
  if (point.x < -20 || point.y < -20 || point.x > ARENA_WIDTH + 20 || point.y > ARENA_HEIGHT + 20) {
    return false;
  }
  const samples = trackPolyline(track);
  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    const next = samples[(index + 1) % samples.length];
    minDistance = Math.min(minDistance, distanceToSegment(point, current, next));
    if (minDistance <= LINE_WIDTH / 2 + SENSOR_TRIGGER_MARGIN) return true;
  }
  return false;
}

function readLine(track: TrackName, robot: RobotState) {
  const positions = sensorPositions(robot);
  const hits = positions.map((p) => isSensorOnLine(track, p)) as [
    boolean,
    boolean,
    boolean,
  ];
  const pattern = hits.map((hit) => (hit ? "1" : "0")).join("");
  const table: Record<string, number> = {
    "010": 0,
    "110": -1.5,
    "100": -3,
    "011": 1.5,
    "001": 3,
    "111": 0,
  };
  const mapped = table[pattern];
  const lost = mapped === undefined;
  const error = lost ? robot.lastDirection * 3 : mapped;
  return { error, lost, pattern, hits };
}

function pwmToWheelSpeed(pwm: number) {
  if (pwm <= MOTOR_DEADBAND_PWM) return 0;
  const normalized = (pwm - MOTOR_DEADBAND_PWM) / (MAX_PWM - MOTOR_DEADBAND_PWM);
  return clamp(normalized, 0, 1) * MAX_WHEEL_SPEED;
}

function motorMix(baseSpeed: number, correction: number, lost: boolean, direction: number) {
  if (lost) {
    const searchDirection = direction >= 0 ? 1 : -1;
    const left = baseSpeed + 6 + SEARCH_PWM_DELTA * searchDirection;
    const right = baseSpeed - SEARCH_PWM_DELTA * searchDirection;
    return {
      leftPwm: clamp(left, 0, MAX_PWM),
      rightPwm: clamp(right, 0, MAX_PWM),
    };
  }

  return {
    leftPwm: clamp(baseSpeed + 6 + correction, 0, MAX_PWM),
    rightPwm: clamp(baseSpeed - correction, 0, MAX_PWM),
  };
}

function drawRobot(ctx: CanvasRenderingContext2D, robot: RobotState, sensors: [boolean, boolean, boolean]) {
  ctx.save();
  ctx.translate(robot.x, robot.y);
  ctx.rotate(robot.angle);

  ctx.fillStyle = "#05070c";
  ctx.fillRect(-24, -32, 48, 10);
  ctx.fillRect(-24, 22, 48, 10);

  ctx.fillStyle = "#2f7df0";
  ctx.fillRect(-24, -18, 48, 36);

  ctx.fillStyle = "#7ed7ff";
  ctx.beginPath();
  ctx.moveTo(31, 0);
  ctx.lineTo(14, -12);
  ctx.lineTo(14, 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#10384e";
  ctx.fillRect(-9, -9, 18, 18);

  ctx.fillStyle = "#8d98a8";
  ctx.fillRect(30, -33, 8, 66);
  [-SENSOR_SPACING, 0, SENSOR_SPACING].forEach((offset, index) => {
    ctx.beginPath();
    ctx.fillStyle = sensors[index] ? "#35f49b" : "#121724";
    ctx.arc(SENSOR_OFFSET, offset, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, trail: Point[]) {
  if (trail.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "rgba(47, 125, 240, 0.34)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  trail.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawMiniChart(canvas: HTMLCanvasElement, values: number[], color: string, range: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#040817";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#17243b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = (index / Math.max(HISTORY_SIZE - 1, 1)) * width;
    const y = height / 2 - (clamp(value, -range, range) / range) * height * 0.36;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function directionLabel(direction: number) {
  if (direction < 0) return "Left";
  if (direction > 0) return "Right";
  return "Center";
}

function sensorLabel(active: boolean) {
  return active ? "ON" : "OFF";
}

export function LineBotSimulator() {
  const arenaRef = useRef<HTMLCanvasElement | null>(null);
  const samplerRef = useRef<HTMLCanvasElement | null>(null);
  const chartRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const robotRef = useRef<RobotState>(makeRobot("infinity"));
  const historyRef = useRef([[], [], [], []] as number[][]);
  const trailRef = useRef<Point[]>([]);
  const runningRef = useRef(false);
  const trackRef = useRef<TrackName>("infinity");
  const paramsRef = useRef({ kp: 10, ki: 0, kd: 20, ts: 10, speed: 150 });
  const telemetryRef = useRef<Telemetry>(initialTelemetry);

  const [running, setRunning] = useState(false);
  const [track, setTrack] = useState<TrackName>("infinity");
  const [params, setParams] = useState({ kp: 10, ki: 0, kd: 20, ts: 10, speed: 150 });
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);

  const charts = useMemo(
    () =>
      chartConfigs.map((chart, index) => ({
        ...chart,
        value: [telemetry.error, telemetry.pTerm, telemetry.iTerm, telemetry.dTerm][index],
      })),
    [telemetry],
  );

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    const arena = arenaRef.current;
    const samplerCanvas = samplerRef.current;
    const ctx = arena?.getContext("2d");
    const sampler = samplerCanvas?.getContext("2d", { willReadFrequently: true });
    if (!arena || !samplerCanvas || !ctx || !sampler) return;

    drawTrack(sampler, trackRef.current);
    let frameId = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let uiTimer = 0;

    const pushHistory = (items: number[]) => {
      items.forEach((item, index) => {
        historyRef.current[index].push(item);
        if (historyRef.current[index].length > HISTORY_SIZE) historyRef.current[index].shift();
      });
    };

    const step = (dt: number) => {
      const robot = robotRef.current;
      const { error, lost, pattern, hits } = readLine(trackRef.current, robot);
      if (error !== 0) robot.lastDirection = Math.sign(error);
      robot.integral = lost ? robot.integral * 0.96 : clamp(robot.integral + error * dt, -25, 25);

      const kpInstability = highKpFactor(paramsRef.current.kp);
      const pTerm = paramsRef.current.kp * error;
      const iTerm = paramsRef.current.ki * robot.integral;
      const dTerm = paramsRef.current.kd * (error - robot.lastError);
      const correction = (pTerm + iTerm + dTerm) * (CONTROL_AGGRESSIVENESS + kpInstability * 0.55);
      robot.lastError = error;

      const { leftPwm, rightPwm } = motorMix(paramsRef.current.speed, correction, lost, robot.lastDirection);
      const motorResponseTime = MOTOR_RESPONSE_TIME + kpInstability * 0.09;
      const motorAlpha = clamp(dt / motorResponseTime, 0, 1);
      robot.leftVelocity += (pwmToWheelSpeed(leftPwm) - robot.leftVelocity) * motorAlpha;
      robot.rightVelocity += (pwmToWheelSpeed(rightPwm) - robot.rightVelocity) * motorAlpha;
      const speed = (robot.leftVelocity + robot.rightVelocity) / 2;
      const steeringGain = 1 + kpInstability * 2.4;
      const targetYawRate = ((robot.leftVelocity - robot.rightVelocity) / SIM_WHEEL_BASE) * steeringGain;
      const yawResponseTime = 0.018 + kpInstability * 0.11;
      robot.yawRate += (targetYawRate - robot.yawRate) * clamp(dt / yawResponseTime, 0, 1);
      robot.angle += robot.yawRate * dt;
      robot.x += Math.cos(robot.angle) * speed * dt;
      robot.y += Math.sin(robot.angle) * speed * dt;

      trailRef.current.push({ x: robot.x, y: robot.y });
      if (trailRef.current.length > TRAIL_SIZE) trailRef.current.shift();

      if (robot.x < -80 || robot.x > ARENA_WIDTH + 80 || robot.y < -80 || robot.y > ARENA_HEIGHT + 80) {
        robotRef.current = makeRobot(trackRef.current);
        trailRef.current = [];
      }

      const nextTelemetry: Telemetry = {
        error,
        pTerm,
        iTerm,
        dTerm,
        leftPwm,
        rightPwm,
        correction,
        pattern,
        lineState: lost ? "Lost line" : "On line",
        lastDirection: robot.lastDirection,
        sensors: hits,
        status: lost ? "Mat line - dang tim lai" : `PWM L:${leftPwm.toFixed(0)} R:${rightPwm.toFixed(0)}`,
      };
      telemetryRef.current = nextTelemetry;
      pushHistory([error, pTerm, iTerm, dTerm]);
    };

    const draw = (now: number) => {
      const delta = Math.min((now - lastTime) / 1000, 0.06);
      lastTime = now;

      if (runningRef.current) {
        accumulator += delta;
        const sampleTime = paramsRef.current.ts / 1000;
        while (accumulator >= sampleTime) {
          step(sampleTime);
          accumulator -= sampleTime;
        }
      }

      drawTrack(ctx, trackRef.current);
      drawTrail(ctx, trailRef.current);
      drawRobot(ctx, robotRef.current, telemetryRef.current.sensors);
      chartConfigs.forEach((chart, index) => {
        const chartCanvas = chartRefs.current[index];
        if (chartCanvas) drawMiniChart(chartCanvas, historyRef.current[index], chart.color, chart.range);
      });

      uiTimer += delta;
      if (uiTimer > 0.12) {
        setTelemetry({ ...telemetryRef.current });
        uiTimer = 0;
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const updateParam = (key: keyof typeof params, value: number) => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  const resetRobot = () => {
    robotRef.current = makeRobot(trackRef.current);
    historyRef.current = [[], [], [], []];
    trailRef.current = [];
    telemetryRef.current = { ...initialTelemetry, status: "Da dat lai robot" };
    setTelemetry(telemetryRef.current);
  };

  const changeTrack = (nextTrack: TrackName) => {
    trackRef.current = nextTrack;
    setTrack(nextTrack);
    robotRef.current = makeRobot(nextTrack);
    historyRef.current = [[], [], [], []];
    trailRef.current = [];
    const sampler = samplerRef.current?.getContext("2d", { willReadFrequently: true });
    if (sampler) drawTrack(sampler, nextTrack);
    const resetTelemetry = { ...initialTelemetry, status: "Da dat lai robot" };
    telemetryRef.current = resetTelemetry;
    setTelemetry(resetTelemetry);
  };

  return (
    <main className="sim-shell">
      <header className="sim-topbar">
        <div>
          <h1>
            3-Sensor Infrared Proximity <span>Line-Following Robot</span>
          </h1>
          <small>PID Simulator</small>
        </div>
      </header>

      <section className="sim-dashboard">
        <aside id="controls" className="control-panel">
          <div className="action-row">
            <button className={running ? "run-button running" : "run-button"} type="button" onClick={() => setRunning(!running)}>
              {running ? <Pause size={18} /> : <Play size={18} />}
              {running ? "PAUSE" : "START"}
            </button>
            <button className="reset-button" type="button" onClick={resetRobot} aria-label="Dat lai robot">
              <RotateCcw size={24} />
            </button>
          </div>

          <section className="track-panel">
            <h2>SELECT TRACK</h2>
            <div className="track-grid">
              {trackOptions.map((option) => (
                <button
                  key={option.value}
                  className={track === option.value ? "track-button active" : "track-button"}
                  type="button"
                  onClick={() => changeTrack(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <div className="slider-list">
            <Slider label="Kp" value={params.kp} min={0} max={100} step={1} color="blue" onChange={(value) => updateParam("kp", value)} />
            <Slider label="Ki" value={params.ki} min={0} max={10} step={0.1} color="green" precision={1} onChange={(value) => updateParam("ki", value)} />
            <Slider label="Kd" value={params.kd} min={0} max={100} step={1} color="yellow" onChange={(value) => updateParam("kd", value)} />
            <Slider label="Sampling Time (Ts)" value={params.ts} min={1} max={100} step={1} color="purple" suffix=" ms" onChange={(value) => updateParam("ts", value)} />
            <Slider label="Base Speed" value={params.speed} min={0} max={255} step={1} color="gray" onChange={(value) => updateParam("speed", value)} />
          </div>
        </aside>

        <section id="arena" className="arena-column">
          <div className="arena-frame">
            <canvas ref={arenaRef} width={ARENA_WIDTH} height={ARENA_HEIGHT} className="arena-canvas" />
            <canvas ref={samplerRef} width={ARENA_WIDTH} height={ARENA_HEIGHT} className="hidden" aria-hidden="true" />
            <div className="arena-hint">Cam bien nam phia truoc xe</div>
            <div className="arena-status">
              <span>{telemetry.status}</span>
              <span>
                L:{telemetry.sensors[0] ? 1 : 0} M:{telemetry.sensors[1] ? 1 : 0} R:{telemetry.sensors[2] ? 1 : 0}
              </span>
              <span>Pattern: {telemetry.pattern}</span>
              <span>Corr: {telemetry.correction.toFixed(1)}</span>
            </div>
          </div>
        </section>

        <aside id="telemetry" className="telemetry-panel">
          <div className="telemetry-heading">
            <h2>LIVE TELEMETRY</h2>
            <p>Theo doi PWM, sai so va cac thanh phan PID cua xe do line 3 cam bien.</p>
          </div>

          <section className="status-grid" aria-label="Trang thai xe">
            <Status label="LEFT PWM" value={telemetry.leftPwm.toFixed(0)} />
            <Status label="RIGHT PWM" value={telemetry.rightPwm.toFixed(0)} />
            <Status label="CORRECTION" value={telemetry.correction.toFixed(2)} />
            <Status label="LINE STATE" value={telemetry.lineState} />
            <Status label="SENSOR PATTERN" value={telemetry.pattern} />
            <Status label="LAST DIRECTION" value={directionLabel(telemetry.lastDirection)} />
          </section>

          <section className="chart-grid">
            {charts.map((chart, index) => (
              <article key={chart.title} className={`chart-card ${chart.className}`}>
                <h3>{chart.title}</h3>
                <strong>{chart.value.toFixed(2)}</strong>
                <canvas ref={(element) => { chartRefs.current[index] = element; }} width={260} height={210} />
              </article>
            ))}
          </section>
        </aside>
      </section>

      <section className="learning-panel" aria-label="Bang trang thai cam bien va ngo ra">
        <div className="learning-header">
          <span>Signal flow</span>
          <h2>Sensor State, Error and Motor Output</h2>
          <p>
            This section explains how the three digital infrared proximity sensors are converted into error, PID
            correction, and left/right PWM output.
          </p>
        </div>

        <div className="live-flow-grid">
          <InfoCard label="Left sensor" value={sensorLabel(telemetry.sensors[0])} tone={telemetry.sensors[0] ? "green" : "muted"} />
          <InfoCard label="Center sensor" value={sensorLabel(telemetry.sensors[1])} tone={telemetry.sensors[1] ? "green" : "muted"} />
          <InfoCard label="Right sensor" value={sensorLabel(telemetry.sensors[2])} tone={telemetry.sensors[2] ? "green" : "muted"} />
          <InfoCard label="Pattern" value={telemetry.pattern} tone="blue" />
          <InfoCard label="Error" value={telemetry.error.toFixed(2)} tone="blue" />
          <InfoCard label="Correction" value={telemetry.correction.toFixed(2)} tone="yellow" />
          <InfoCard label="Left PWM" value={telemetry.leftPwm.toFixed(0)} tone="red" />
          <InfoCard label="Right PWM" value={telemetry.rightPwm.toFixed(0)} tone="red" />
        </div>

        <div className="logic-grid">
          <article className="logic-card">
            <h3>Sensor Truth Table</h3>
            <div className="state-table-wrap">
              <table className="state-table">
                <thead>
                  <tr>
                    <th>Pattern L-M-R</th>
                    <th>Meaning</th>
                    <th>Error</th>
                    <th>Robot action</th>
                  </tr>
                </thead>
                <tbody>
                  {sensorStateRows.map((row) => (
                    <tr key={row.pattern} className={telemetry.pattern === row.pattern ? "active-row" : ""}>
                      <td>
                        <code>{row.pattern}</code>
                      </td>
                      <td>{row.sensor}</td>
                      <td>{row.error}</td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="logic-card formula-card">
            <h3>PID and Output Mixing</h3>
            <dl>
              <div>
                <dt>Error</dt>
                <dd>Negative means line is on the left, positive means line is on the right.</dd>
              </div>
              <div>
                <dt>PID correction</dt>
                <dd>Correction = Kp x error + Ki x integral + Kd x delta error.</dd>
              </div>
              <div>
                <dt>Motor output</dt>
                <dd>Left PWM = base speed + correction, Right PWM = base speed - correction.</dd>
              </div>
              <div>
                <dt>High Kp behavior</dt>
                <dd>Large Kp creates stronger steering, so the robot may overshoot and zig-zag around the line.</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>
    </main>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <article className="status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function InfoCard({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "yellow" | "red" | "muted" }) {
  return (
    <article className={`info-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  color,
  suffix = "",
  precision = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color: "blue" | "green" | "yellow" | "purple" | "gray";
  suffix?: string;
  precision?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`slider-card ${color}`}>
      <span>
        <strong>{label}</strong>
        <output>
          {value.toFixed(precision)}
          {suffix}
        </output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
