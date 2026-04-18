const mapCanvas = document.getElementById('mapcanvas');
const canvas = document.getElementById('glcanvas');
const overlay = document.getElementById('overlay');

const mapCtx = mapCanvas.getContext('2d');
const overlayCtx = overlay.getContext('2d');
const gl = canvas.getContext('webgl2', {
alpha: true,
antialias: false,
premultipliedAlpha: false
});

if (!gl) {
alert('Нужен браузер с поддержкой WebGL2.');
throw new Error('WebGL2 is not available');
}

let mapReady = false;
let mapWidth = window.innerWidth;
let mapHeight = window.innerHeight;
let hasUserInteracted = false;

const mapImage = new Image();
mapImage.src = 'Снимок экрана 2026-04-17 180436.png';

const camera = {
x: mapWidth * 0.5,
y: mapHeight * 0.5,
zoom: 1,
minZoom: 0.25,
maxZoom: 5
};

const UNIT_RADIUS = 10;
const CLICK_THRESHOLD = 4;
const KEYFRAME_SNAP = 0.07;
const KEY_HANDLE_RADIUS = 6;
const KEY_HANDLE_HIT_RADIUS = 11;

const animationState = {
currentTime: 0,
duration: 120,
playing: false,
lastTimestamp: 0,
speed: 1,
loop: true
};

let animationRaf = null;
let nextUnitId = 1;

const factionDefaultRadius = { 1: 70, 2: 70 };
const selectedUnit = { faction: null, index: -1 };

const pointerState = {
mode: null,
faction: null,
index: -1,
keyIndex: -1,
startX: 0,
startY: 0,
startCamX: 0,
startCamY: 0,
moved: false
};

let isSpaceDown = false;
let units1 = [];
let units2 = [];

const unitRadiusInput = document.getElementById('unitRadius');
const unitRadiusValue = document.getElementById('unitRadiusValue');
const smoothInput = document.getElementById('smooth');
const frontWidthInput = document.getElementById('frontWidth');
const frontWidthValue = document.getElementById('frontWidthValue');

const timelineInput = document.getElementById('timeline');
const timelineValue = document.getElementById('timelineValue');
const durationInput = document.getElementById('duration');
const durationValue = document.getElementById('durationValue');
const playPauseBtn = document.getElementById('playPauseBtn');
const addKeyBtn = document.getElementById('addKeyBtn');
const deleteKeyBtn = document.getElementById('deleteKeyBtn');
const keyframeMeta = document.getElementById('keyframeMeta');
const timelineDock = document.getElementById('timelineDock');
const timelineTrack = document.getElementById('timelineTrack');
const timelineMarkers = document.getElementById('timelineMarkers');
const timelinePlayhead = document.getElementById('timelinePlayhead');
const timelineSelectedLabel = document.getElementById('timelineSelectedLabel');
const timelineCurrentLabel = document.getElementById('timelineCurrentLabel');
const simDateLabel = document.getElementById('simDate');
const simTimeLabel = document.getElementById('simTime');
const startDateInput = document.getElementById('startDate');
const dayDurationInput = document.getElementById('dayDuration');
const dayDurationValue = document.getElementById('dayDurationValue');

let timelineScrubActive = false;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const chronoState = {
startDateMsUtc: Date.UTC(1941, 0, 1),
dayDuration: 12
};

function clamp(value, min, max) {
return Math.max(min, Math.min(max, value));
}

function formatSeconds(value) {
return `${value.toFixed(1)} c`;
}

function parseDateInputToUtcMs(value) {
if (!value) return Date.UTC(1941, 0, 1);
const [yearStr, monthStr, dayStr] = value.split('-');
const year = Number(yearStr);
const month = Number(monthStr);
const day = Number(dayStr);
if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
return Date.UTC(1941, 0, 1);
}
return Date.UTC(year, month - 1, day);
}

function formatDateFromUtcMs(ms) {
const d = new Date(ms);
const day = String(d.getUTCDate()).padStart(2, '0');
const month = String(d.getUTCMonth() + 1).padStart(2, '0');
const year = d.getUTCFullYear();
return `${day}.${month}.${year}`;
}

function formatClockFromMinutes(totalMinutes) {
if (totalMinutes >= 1440) return '24:00';
const hours = Math.floor(totalMinutes / 60);
return `${String(hours).padStart(2, '0')}:00`;
}

function updateSimDateTime() {
const dayDuration = Math.max(0.1, chronoState.dayDuration);
const totalDays = animationState.currentTime / dayDuration;
const wholeDays = Math.floor(totalDays);
const dayFraction = totalDays - wholeDays;
const minutesRaw = Math.round(dayFraction * 1440);
const minutesInDay = clamp(minutesRaw, 0, 1440);

const currentDateMs = chronoState.startDateMsUtc + wholeDays * MS_PER_DAY;
simDateLabel.textContent = formatDateFromUtcMs(currentDateMs);
simTimeLabel.textContent = formatClockFromMinutes(minutesInDay);
}

function updateDayDurationLabel() {
dayDurationValue.textContent = `${chronoState.dayDuration.toFixed(1)} c/день`;
}

function timeToPercent(time) {
return clamp(time / Math.max(animationState.duration, 0.0001), 0, 1) * 100;
}

function updateTimelineCurrentLabel() {
timelineCurrentLabel.textContent = `${formatSeconds(animationState.currentTime)} / ${Math.round(animationState.duration)} c`;
timelineTrack.setAttribute('aria-valuemax', String(animationState.duration));
timelineTrack.setAttribute('aria-valuenow', String(animationState.currentTime.toFixed(1)));
}

function updateTimelinePlayhead() {
timelinePlayhead.style.left = `${timeToPercent(animationState.currentTime)}%`;
}

function updateTimelineMarkersSelection() {
const markers = timelineMarkers.querySelectorAll('.timeline-marker');
markers.forEach((marker) => {
const t = parseFloat(marker.dataset.time);
const isActive = Math.abs(t - animationState.currentTime) <= KEYFRAME_SNAP;
marker.classList.toggle('active', isActive);
});
}

function renderBottomTimeline() {
const unit = getSelectedUnitRef();
timelineMarkers.innerHTML = '';

if (!unit) {
timelineSelectedLabel.textContent = 'Выберите дивизию, чтобы увидеть ее ключи';
updateTimelinePlayhead();
updateTimelineCurrentLabel();
return;
}

timelineSelectedLabel.textContent = `Дивизия: ключей ${unit.keyframes.length}`;

const sorted = [...unit.keyframes].sort((a, b) => a.t - b.t);
for (let i = 0; i < sorted.length; i += 1) {
const key = sorted[i];
const marker = document.createElement('button');
marker.type = 'button';
marker.className = 'timeline-marker';
marker.style.left = `${timeToPercent(key.t)}%`;
marker.dataset.time = key.t.toFixed(4);
marker.title = `Кадр: ${formatSeconds(key.t)}`;
if (Math.abs(key.t - animationState.currentTime) <= KEYFRAME_SNAP) {
marker.classList.add('active');
}

marker.addEventListener('mousedown', (event) => {
event.stopPropagation();
});

marker.addEventListener('click', (event) => {
event.stopPropagation();
setPlaying(false);
setCurrentTime(key.t);
draw();
});

timelineMarkers.appendChild(marker);
}

updateTimelinePlayhead();
updateTimelineCurrentLabel();
}

function seekTimelineByClientX(clientX) {
const rect = timelineTrack.getBoundingClientRect();
const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
setCurrentTime(animationState.duration * ratio);
}

function markInteracted() {
hasUserInteracted = true;
}

function getUnitList(faction) {
return faction === 1 ? units1 : units2;
}

function getSelectedUnitRef() {
if (selectedUnit.faction === null || selectedUnit.index < 0) return null;
const list = getUnitList(selectedUnit.faction);
return list[selectedUnit.index] || null;
}

function sortKeyframes(unit) {
unit.keyframes.sort((a, b) => a.t - b.t);
}

function findKeyframeIndexNear(unit, time, epsilon = KEYFRAME_SNAP) {
for (let i = 0; i < unit.keyframes.length; i += 1) {
if (Math.abs(unit.keyframes[i].t - time) <= epsilon) return i;
}
return -1;
}

function getLockedKeyIndex(unit) {
if (!unit) return -1;
return findKeyframeIndexNear(unit, animationState.currentTime);
}

function getUnitPoseAtTime(unit, time) {
const keys = unit.keyframes;
if (!keys || keys.length === 0) {
return { x: unit.x, y: unit.y, radius: unit.radius };
}

if (keys.length === 1) {
const k = keys[0];
return { x: k.x, y: k.y, radius: k.radius };
}

if (time <= keys[0].t) {
const k = keys[0];
return { x: k.x, y: k.y, radius: k.radius };
}

const last = keys[keys.length - 1];
if (time >= last.t) {
return { x: last.x, y: last.y, radius: last.radius };
}

for (let i = 0; i < keys.length - 1; i += 1) {
const a = keys[i];
const b = keys[i + 1];
if (time < a.t || time > b.t) continue;

const span = Math.max(0.00001, b.t - a.t);
const k = clamp((time - a.t) / span, 0, 1);
return {
x: a.x + (b.x - a.x) * k,
y: a.y + (b.y - a.y) * k,
radius: a.radius + (b.radius - a.radius) * k
};
}

return { x: last.x, y: last.y, radius: last.radius };
}

function ensureKeyframeAtTime(unit, time) {
const t = clamp(time, 0, animationState.duration);
const existing = findKeyframeIndexNear(unit, t);
if (existing >= 0) return unit.keyframes[existing];

const pose = getUnitPoseAtTime(unit, t);
const frame = { t, x: pose.x, y: pose.y, radius: pose.radius };
unit.keyframes.push(frame);
sortKeyframes(unit);
return frame;
}

function upsertCurrentKeyframe(unit) {
const t = clamp(animationState.currentTime, 0, animationState.duration);
const existing = findKeyframeIndexNear(unit, t);
if (existing >= 0) {
return { frame: unit.keyframes[existing], index: existing, created: false };
}

const pose = getUnitPoseAtTime(unit, t);
const frame = { t, x: pose.x, y: pose.y, radius: pose.radius };
unit.keyframes.push(frame);
sortKeyframes(unit);
return {
frame,
index: unit.keyframes.indexOf(frame),
created: true
};
}

function removeKeyframeAtTime(unit, time) {
const idx = findKeyframeIndexNear(unit, time);
if (idx < 0) return false;

const removed = unit.keyframes[idx];
unit.keyframes.splice(idx, 1);
if (unit.keyframes.length === 0) {
unit.x = removed.x;
unit.y = removed.y;
unit.radius = removed.radius;
}
return true;
}

function createUnit(worldX, worldY, radius) {
const unit = {
id: nextUnitId,
x: worldX,
y: worldY,
radius,
keyframes: []
};
nextUnitId += 1;
unit.keyframes.push({ t: animationState.currentTime, x: worldX, y: worldY, radius });
return unit;
}

function seedInitialUnits() {
units1 = [createUnit(mapWidth * 0.35, mapHeight * 0.5, 70)];
units2 = [createUnit(mapWidth * 0.65, mapHeight * 0.5, 70)];
}

seedInitialUnits();

function fitCameraToMap() {
const fitZoom = Math.min(canvas.width / mapWidth, canvas.height / mapHeight);
camera.x = mapWidth * 0.5;
camera.y = mapHeight * 0.5;
camera.zoom = clamp(fitZoom, camera.minZoom, camera.maxZoom);
}

function worldToScreen(x, y) {
return {
x: (x - camera.x) * camera.zoom + canvas.width * 0.5,
y: (y - camera.y) * camera.zoom + canvas.height * 0.5
};
}

function screenToWorld(x, y) {
return {
x: (x - canvas.width * 0.5) / camera.zoom + camera.x,
y: (y - canvas.height * 0.5) / camera.zoom + camera.y
};
}

function getMousePos(e) {
const rect = overlay.getBoundingClientRect();
return {
x: clamp(e.clientX - rect.left, 0, canvas.width),
y: clamp(e.clientY - rect.top, 0, canvas.height)
};
}

function updateKeyframeMeta() {
const unit = getSelectedUnitRef();
if (!unit) {
keyframeMeta.textContent = 'Ключи выбранной: -';
addKeyBtn.disabled = true;
deleteKeyBtn.disabled = true;
return;
}

const keyCount = unit.keyframes.length;
const hasCurrentKey = findKeyframeIndexNear(unit, animationState.currentTime) >= 0;
keyframeMeta.textContent = hasCurrentKey
? `Ключи выбранной: ${keyCount} (ключ в текущем времени)`
: `Ключи выбранной: ${keyCount}`;
addKeyBtn.disabled = false;
deleteKeyBtn.disabled = !hasCurrentKey;
}

function syncUnitRadiusControl() {
const unit = getSelectedUnitRef();
if (!unit) {
unitRadiusInput.disabled = true;
unitRadiusValue.textContent = '-';
updateKeyframeMeta();
return;
}

const pose = getUnitPoseAtTime(unit, animationState.currentTime);
unitRadiusInput.disabled = false;
unitRadiusInput.value = String(Math.round(pose.radius));
unitRadiusValue.textContent = `${Math.round(pose.radius)} px`;
updateKeyframeMeta();
}

function selectUnit(faction, index) {
selectedUnit.faction = faction;
selectedUnit.index = index;
syncUnitRadiusControl();
renderBottomTimeline();
}

function clearSelection() {
selectedUnit.faction = null;
selectedUnit.index = -1;
syncUnitRadiusControl();
renderBottomTimeline();
}

function deleteUnit(faction, index) {
const list = getUnitList(faction);
if (!list[index]) return;
list.splice(index, 1);

if (selectedUnit.faction === faction) {
if (selectedUnit.index === index) {
clearSelection();
} else if (selectedUnit.index > index) {
selectedUnit.index -= 1;
syncUnitRadiusControl();
}
}

updateKeyframeMeta();
renderBottomTimeline();
}

function setDuration(value) {
animationState.duration = clamp(value, 10, 600);
durationInput.value = String(animationState.duration);
durationValue.textContent = `${Math.round(animationState.duration)} c`;
timelineInput.max = String(animationState.duration);

if (animationState.currentTime > animationState.duration) {
setCurrentTime(animationState.duration);
}

renderBottomTimeline();
}

function setCurrentTime(value) {
animationState.currentTime = clamp(value, 0, animationState.duration);
timelineInput.value = animationState.currentTime.toFixed(1);
timelineValue.textContent = `${animationState.currentTime.toFixed(1)} c`;
syncUnitRadiusControl();
updateTimelineCurrentLabel();
updateTimelinePlayhead();
updateTimelineMarkersSelection();
updateSimDateTime();
}

function setPlaying(playing) {
if (animationState.playing === playing) return;
animationState.playing = playing;
playPauseBtn.textContent = playing ? '⏸ Пауза' : '▶ Пуск';

if (playing) {
animationState.lastTimestamp = 0;
animationRaf = requestAnimationFrame(animationTick);
} else if (animationRaf !== null) {
cancelAnimationFrame(animationRaf);
animationRaf = null;
}
}

function animationTick(timestamp) {
if (!animationState.playing) return;

if (animationState.lastTimestamp === 0) {
animationState.lastTimestamp = timestamp;
}

const dt = (timestamp - animationState.lastTimestamp) / 1000;
animationState.lastTimestamp = timestamp;

let nextTime = animationState.currentTime + dt * animationState.speed;
if (nextTime > animationState.duration) {
if (animationState.loop) {
nextTime = nextTime % animationState.duration;
} else {
nextTime = animationState.duration;
setPlaying(false);
}
}

setCurrentTime(nextTime);
draw();

if (animationState.playing) {
animationRaf = requestAnimationFrame(animationTick);
}
}

function addKeyframeForSelected() {
const unit = getSelectedUnitRef();
if (!unit) return;

const inserted = upsertCurrentKeyframe(unit);
const frame = inserted.frame;
const pose = getUnitPoseAtTime(unit, animationState.currentTime);
frame.x = pose.x;
frame.y = pose.y;
frame.radius = pose.radius;
unit.x = frame.x;
unit.y = frame.y;
unit.radius = frame.radius;

updateKeyframeMeta();
renderBottomTimeline();
draw();
}

function deleteKeyframeForSelected() {
const unit = getSelectedUnitRef();
if (!unit) return;

if (!removeKeyframeAtTime(unit, animationState.currentTime)) {
updateKeyframeMeta();
return;
}

const pose = getUnitPoseAtTime(unit, animationState.currentTime);
unit.x = pose.x;
unit.y = pose.y;
unit.radius = pose.radius;

syncUnitRadiusControl();
renderBottomTimeline();
draw();
}

function addUnitAtScreen(x, y) {
const faction = parseInt(document.querySelector('input[name="faction"]:checked').value, 10);
const list = getUnitList(faction);
const world = screenToWorld(x, y);
const newUnit = createUnit(world.x, world.y, factionDefaultRadius[faction] || 70);
list.push(newUnit);
selectUnit(faction, list.length - 1);
markInteracted();
}

function findUnitAtScreen(x, y) {
const hitRadius = UNIT_RADIUS + 4;
const hitRadiusSq = hitRadius * hitRadius;

for (let i = units1.length - 1; i >= 0; i -= 1) {
const pose = getUnitPoseAtTime(units1[i], animationState.currentTime);
const screen = worldToScreen(pose.x, pose.y);
const dx = screen.x - x;
const dy = screen.y - y;
if (dx * dx + dy * dy <= hitRadiusSq) {
return { faction: 1, index: i };
}
}

for (let i = units2.length - 1; i >= 0; i -= 1) {
const pose = getUnitPoseAtTime(units2[i], animationState.currentTime);
const screen = worldToScreen(pose.x, pose.y);
const dx = screen.x - x;
const dy = screen.y - y;
if (dx * dx + dy * dy <= hitRadiusSq) {
return { faction: 2, index: i };
}
}

return null;
}

function findSelectedKeyHandleAtScreen(x, y) {
const unit = getSelectedUnitRef();
if (!unit || unit.keyframes.length === 0) return null;

const lockedIndex = getLockedKeyIndex(unit);
const hitRadiusSq = KEY_HANDLE_HIT_RADIUS * KEY_HANDLE_HIT_RADIUS;
for (let i = unit.keyframes.length - 1; i >= 0; i -= 1) {
if (i === lockedIndex) continue;
const key = unit.keyframes[i];
const pos = worldToScreen(key.x, key.y);
const dx = pos.x - x;
const dy = pos.y - y;
if (dx * dx + dy * dy <= hitRadiusSq) {
return { keyIndex: i, keyframe: key };
}
}

return null;
}

function drawMapLayer() {
mapCtx.setTransform(1, 0, 0, 1, 0, 0);
mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

if (!mapReady) return;

mapCtx.save();
mapCtx.setTransform(
camera.zoom,
0,
0,
camera.zoom,
mapCanvas.width * 0.5 - camera.x * camera.zoom,
mapCanvas.height * 0.5 - camera.y * camera.zoom
);
mapCtx.drawImage(mapImage, 0, 0, mapWidth, mapHeight);
mapCtx.restore();
}

function drawUnitsLayer() {
overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

const selected = getSelectedUnitRef();
if (selected && selected.keyframes.length > 0) {
const lockedIndex = getLockedKeyIndex(selected);
overlayCtx.save();
overlayCtx.strokeStyle = 'rgba(255, 245, 163, 0.95)';
overlayCtx.lineWidth = 2;
overlayCtx.beginPath();

for (let i = 0; i < selected.keyframes.length; i += 1) {
const key = selected.keyframes[i];
const pos = worldToScreen(key.x, key.y);
if (i === 0) {
overlayCtx.moveTo(pos.x, pos.y);
} else {
overlayCtx.lineTo(pos.x, pos.y);
}
}
overlayCtx.stroke();

for (let i = 0; i < selected.keyframes.length; i += 1) {
const key = selected.keyframes[i];
const pos = worldToScreen(key.x, key.y);
const isCurrent = Math.abs(key.t - animationState.currentTime) <= KEYFRAME_SNAP;
const isLocked = i === lockedIndex;

overlayCtx.beginPath();
overlayCtx.arc(pos.x, pos.y, KEY_HANDLE_RADIUS, 0, Math.PI * 2);
overlayCtx.fillStyle = isLocked ? '#9aa0a6' : (isCurrent ? '#ffe66b' : '#f5f5f5');
overlayCtx.fill();
overlayCtx.lineWidth = 2;
overlayCtx.strokeStyle = isLocked ? '#474c52' : (isCurrent ? '#7f5a00' : '#252525');
overlayCtx.stroke();
}

overlayCtx.restore();
}

function paint(units, faction, fillColor, strokeColor) {
units.forEach((unit, index) => {
const pose = getUnitPoseAtTime(unit, animationState.currentTime);
const pos = worldToScreen(pose.x, pose.y);
if (pos.x < -30 || pos.y < -30 || pos.x > overlay.width + 30 || pos.y > overlay.height + 30) return;

const isSelected = selectedUnit.faction === faction && selectedUnit.index === index;
overlayCtx.beginPath();
overlayCtx.arc(pos.x, pos.y, UNIT_RADIUS, 0, Math.PI * 2);
overlayCtx.fillStyle = fillColor;
overlayCtx.fill();
overlayCtx.lineWidth = isSelected ? 3 : 2;
overlayCtx.strokeStyle = isSelected ? '#fff5a3' : strokeColor;
overlayCtx.stroke();
});
}

paint(units1, 1, '#2f78ff', '#d8e6ff');
paint(units2, 2, '#d43a3a', '#ffd6d6');
}

const vsSource = `#version 300 es
in vec2 a_position;
void main() {
gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fsSource = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_resolution;
uniform float u_smoothness;
uniform float u_frontThickness;
uniform vec2 u_camera;
uniform float u_zoom;

uniform int u_count1;
uniform int u_count2;
uniform sampler2D u_units1Tex;
uniform sampler2D u_units2Tex;

out vec4 outColor;

vec4 readUnit(sampler2D tex, int index) {
return texelFetch(tex, ivec2(index, 0), 0);
}

float getInfluence(vec2 world, vec4 unitData) {
float dist = distance(world, unitData.xy);
float falloff = 1.0 - smoothstep(0.0, unitData.z, dist);
return pow(max(falloff, 0.0), u_smoothness);
}

void main() {
vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
vec2 world = (screen - u_resolution * 0.5) / u_zoom + u_camera;

float inf1 = 0.0;
float inf2 = 0.0;
float near1 = 0.0;
float near2 = 0.0;

for (int i = 0; i < u_count1; i++) {
float local = getInfluence(world, readUnit(u_units1Tex, i));
inf1 += local;
near1 = max(near1, local);
}

for (int i = 0; i < u_count2; i++) {
float local = getInfluence(world, readUnit(u_units2Tex, i));
inf2 += local;
near2 = max(near2, local);
}

vec3 col1 = vec3(0.15, 0.4, 0.8);
vec3 col2 = vec3(0.8, 0.2, 0.2);
vec3 finalColor = vec3(0.0);
float finalAlpha = 0.0;

float dominant = max(inf1, inf2);
if (dominant > 0.001) {
if (inf1 > inf2) {
finalColor = col1;
} else {
finalColor = col2;
}

// Суммарное влияние дивизий одного цвета усиливает плотность/непрозрачность зоны.
float density = 1.0 - exp(-dominant * 1.35);
float nearDensity = max(near1, near2);
float baseAlpha = max(density, nearDensity * 0.85);
finalAlpha = clamp(baseAlpha * 0.95 + 0.08, 0.0, 0.98);

float ratio = min(inf1, inf2) / max(dominant, 0.0001);
float contact = min(inf1, inf2);
float contactStrength = 1.0 - exp(-contact * 1.4);
float dynamicBand = clamp(u_frontThickness * (0.6 + contactStrength * 2.6), 0.01, 0.9);
float edge = smoothstep(1.0 - dynamicBand, 1.0, ratio);

float edgePaint = clamp(edge * (1.15 + contactStrength * 0.75), 0.0, 1.0);
finalColor = mix(finalColor, vec3(1.0), edgePaint);
finalAlpha = max(finalAlpha, edge * (0.82 + contactStrength * 0.35));
}

outColor = vec4(finalColor, finalAlpha);
}`;

function createShader(glContext, type, source) {
const shader = glContext.createShader(type);
glContext.shaderSource(shader, source);
glContext.compileShader(shader);
if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
const message = glContext.getShaderInfoLog(shader);
throw new Error(`Shader compile error: ${message}`);
}
return shader;
}

function createProgram(glContext, vertexSource, fragmentSource) {
const program = glContext.createProgram();
glContext.attachShader(program, createShader(glContext, glContext.VERTEX_SHADER, vertexSource));
glContext.attachShader(program, createShader(glContext, glContext.FRAGMENT_SHADER, fragmentSource));
glContext.linkProgram(program);
if (!glContext.getProgramParameter(program, glContext.LINK_STATUS)) {
const message = glContext.getProgramInfoLog(program);
throw new Error(`Program link error: ${message}`);
}
return program;
}

const program = createProgram(gl, vsSource, fsSource);
gl.useProgram(program);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
gl.clearColor(0.0, 0.0, 0.0, 0.0);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(
gl.ARRAY_BUFFER,
new Float32Array([
-1.0, -1.0,
1.0, -1.0,
-1.0, 1.0,
-1.0, 1.0,
1.0, -1.0,
1.0, 1.0
]),
gl.STATIC_DRAW
);

const posLoc = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

const uLocs = {
res: gl.getUniformLocation(program, 'u_resolution'),
smooth: gl.getUniformLocation(program, 'u_smoothness'),
frontThickness: gl.getUniformLocation(program, 'u_frontThickness'),
camera: gl.getUniformLocation(program, 'u_camera'),
zoom: gl.getUniformLocation(program, 'u_zoom'),
c1: gl.getUniformLocation(program, 'u_count1'),
c2: gl.getUniformLocation(program, 'u_count2'),
tex1: gl.getUniformLocation(program, 'u_units1Tex'),
tex2: gl.getUniformLocation(program, 'u_units2Tex')
};

function createUnitsTexture() {
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
return texture;
}

const unitsTex1 = createUnitsTexture();
const unitsTex2 = createUnitsTexture();

function uploadUnits(texture, units) {
const count = units.length;
const width = Math.max(1, count);
const buffer = new Float32Array(width * 4);

for (let i = 0; i < count; i += 1) {
const pose = getUnitPoseAtTime(units[i], animationState.currentTime);
const k = i * 4;
buffer[k] = pose.x;
buffer[k + 1] = pose.y;
buffer[k + 2] = pose.radius;
buffer[k + 3] = 1.0;
}

gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, buffer);
return count;
}

function resize() {
mapCanvas.width = window.innerWidth;
mapCanvas.height = window.innerHeight;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
overlay.width = window.innerWidth;
overlay.height = window.innerHeight;
gl.viewport(0, 0, canvas.width, canvas.height);

if (!hasUserInteracted && mapReady) {
fitCameraToMap();
}

draw();
}

window.addEventListener('resize', resize);

window.addEventListener('keydown', (e) => {
if (e.code === 'Space') {
isSpaceDown = true;
e.preventDefault();
}
});

window.addEventListener('keyup', (e) => {
if (e.code === 'Space') {
isSpaceDown = false;
}
});

overlay.addEventListener('contextmenu', (e) => e.preventDefault());

overlay.addEventListener('wheel', (e) => {
e.preventDefault();
const pos = getMousePos(e);
const before = screenToWorld(pos.x, pos.y);
const scale = e.deltaY < 0 ? 1.12 : 0.89;
camera.zoom = clamp(camera.zoom * scale, camera.minZoom, camera.maxZoom);
const after = screenToWorld(pos.x, pos.y);
camera.x += before.x - after.x;
camera.y += before.y - after.y;
markInteracted();
draw();
}, { passive: false });

overlay.addEventListener('mousedown', (e) => {
const pos = getMousePos(e);
const handleHit = e.button === 0 && !isSpaceDown ? findSelectedKeyHandleAtScreen(pos.x, pos.y) : null;
const hit = findUnitAtScreen(pos.x, pos.y);

if (e.button === 2) {
setPlaying(false);
if (hit) {
deleteUnit(hit.faction, hit.index);
markInteracted();
draw();
}
return;
}

if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
pointerState.mode = 'pan';
pointerState.startX = pos.x;
pointerState.startY = pos.y;
pointerState.startCamX = camera.x;
pointerState.startCamY = camera.y;
pointerState.moved = false;
return;
}

if (e.button !== 0) return;

setPlaying(false);

pointerState.mode = hit ? 'unit' : 'map';
pointerState.faction = hit ? hit.faction : null;
pointerState.index = hit ? hit.index : -1;
pointerState.keyIndex = -1;
pointerState.startX = pos.x;
pointerState.startY = pos.y;
pointerState.startCamX = camera.x;
pointerState.startCamY = camera.y;
pointerState.moved = false;

if (hit) {
selectUnit(hit.faction, hit.index);
drawUnitsLayer();
return;
}

if (handleHit && selectedUnit.faction !== null && selectedUnit.index >= 0) {
pointerState.mode = 'keyframe-handle';
pointerState.faction = selectedUnit.faction;
pointerState.index = selectedUnit.index;
pointerState.keyIndex = handleHit.keyIndex;
pointerState.startX = pos.x;
pointerState.startY = pos.y;
pointerState.startCamX = camera.x;
pointerState.startCamY = camera.y;
pointerState.moved = false;
}
});

window.addEventListener('mousemove', (e) => {
if (timelineScrubActive) {
seekTimelineByClientX(e.clientX);
draw();
return;
}

if (!pointerState.mode) return;

const pos = getMousePos(e);
const travel = Math.hypot(pos.x - pointerState.startX, pos.y - pointerState.startY);
if (travel > CLICK_THRESHOLD) pointerState.moved = true;

if (pointerState.mode === 'pan') {
camera.x = pointerState.startCamX - (pos.x - pointerState.startX) / camera.zoom;
camera.y = pointerState.startCamY - (pos.y - pointerState.startY) / camera.zoom;
markInteracted();
draw();
return;
}

if (pointerState.mode === 'keyframe-handle') {
const list = pointerState.faction === 1 ? units1 : units2;
const unit = list[pointerState.index];
if (!unit || !unit.keyframes[pointerState.keyIndex]) return;

const world = screenToWorld(pos.x, pos.y);
unit.keyframes[pointerState.keyIndex].x = world.x;
unit.keyframes[pointerState.keyIndex].y = world.y;
markInteracted();
draw();
return;
}

if (pointerState.mode !== 'unit' || pointerState.index < 0) return;
const list = pointerState.faction === 1 ? units1 : units2;
const unit = list[pointerState.index];
if (!unit) return;

if (pointerState.keyIndex < 0) {
const inserted = upsertCurrentKeyframe(unit);
pointerState.keyIndex = inserted.index;
if (inserted.created) {
renderBottomTimeline();
} else {
updateTimelineMarkersSelection();
}
}

const world = screenToWorld(pos.x, pos.y);
const frame = unit.keyframes[pointerState.keyIndex] || upsertCurrentKeyframe(unit).frame;
frame.x = world.x;
frame.y = world.y;
unit.x = frame.x;
unit.y = frame.y;
markInteracted();
draw();
});

window.addEventListener('mouseup', (e) => {
if (timelineScrubActive && e.button === 0) {
timelineScrubActive = false;
}

if (!pointerState.mode) return;

const pos = getMousePos(e);
const travel = Math.hypot(pos.x - pointerState.startX, pos.y - pointerState.startY);
const isClick = travel <= CLICK_THRESHOLD;

if (pointerState.mode === 'map' && e.button === 0 && isClick && !isSpaceDown) {
addUnitAtScreen(pos.x, pos.y);
}

pointerState.mode = null;
pointerState.faction = null;
pointerState.index = -1;
pointerState.keyIndex = -1;
pointerState.moved = false;
syncUnitRadiusControl();
draw();
});

document.getElementById('clearBtn').addEventListener('click', () => {
setPlaying(false);
units1 = [];
units2 = [];
clearSelection();
markInteracted();
draw();
});

unitRadiusInput.addEventListener('input', () => {
const unit = getSelectedUnitRef();
if (!unit) return;
const value = parseFloat(unitRadiusInput.value);
const inserted = upsertCurrentKeyframe(unit);
const frame = inserted.frame;
frame.radius = value;
unit.radius = value;
factionDefaultRadius[selectedUnit.faction] = value;
unitRadiusValue.textContent = `${Math.round(value)} px`;
if (inserted.created) renderBottomTimeline();
markInteracted();
draw();
});

smoothInput.addEventListener('input', draw);

frontWidthInput.addEventListener('input', () => {
frontWidthValue.textContent = Number(frontWidthInput.value).toFixed(2);
draw();
});

timelineInput.addEventListener('input', () => {
setPlaying(false);
setCurrentTime(parseFloat(timelineInput.value));
draw();
});

timelineTrack.addEventListener('mousedown', (event) => {
if (event.button !== 0) return;
event.preventDefault();
setPlaying(false);
timelineScrubActive = true;
seekTimelineByClientX(event.clientX);
draw();
});

durationInput.addEventListener('input', () => {
setDuration(parseFloat(durationInput.value));
draw();
});

startDateInput.addEventListener('input', () => {
chronoState.startDateMsUtc = parseDateInputToUtcMs(startDateInput.value);
updateSimDateTime();
});

dayDurationInput.addEventListener('input', () => {
chronoState.dayDuration = clamp(parseFloat(dayDurationInput.value), 0.1, 600);
updateDayDurationLabel();
updateSimDateTime();
});

playPauseBtn.addEventListener('click', () => {
setPlaying(!animationState.playing);
});

addKeyBtn.addEventListener('click', () => {
setPlaying(false);
addKeyframeForSelected();
});

deleteKeyBtn.addEventListener('click', () => {
setPlaying(false);
deleteKeyframeForSelected();
});

mapImage.onload = () => {
mapReady = true;
mapWidth = mapImage.naturalWidth || mapWidth;
mapHeight = mapImage.naturalHeight || mapHeight;

if (!hasUserInteracted) {
fitCameraToMap();
setCurrentTime(0);
seedInitialUnits();
}

draw();
};

function drawInfluenceLayer() {
gl.useProgram(program);
gl.uniform2f(uLocs.res, canvas.width, canvas.height);
gl.uniform1f(uLocs.smooth, parseFloat(smoothInput.value));
gl.uniform1f(uLocs.frontThickness, parseFloat(frontWidthInput.value));
gl.uniform2f(uLocs.camera, camera.x, camera.y);
gl.uniform1f(uLocs.zoom, camera.zoom);

const count1 = uploadUnits(unitsTex1, units1);
const count2 = uploadUnits(unitsTex2, units2);

gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, unitsTex1);
gl.uniform1i(uLocs.tex1, 0);

gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, unitsTex2);
gl.uniform1i(uLocs.tex2, 1);

gl.uniform1i(uLocs.c1, count1);
gl.uniform1i(uLocs.c2, count2);

gl.clear(gl.COLOR_BUFFER_BIT);
gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function draw() {
drawMapLayer();
drawInfluenceLayer();
drawUnitsLayer();
}

setDuration(animationState.duration);
setCurrentTime(animationState.currentTime);
resize();
syncUnitRadiusControl();
frontWidthValue.textContent = Number(frontWidthInput.value).toFixed(2);
chronoState.startDateMsUtc = parseDateInputToUtcMs(startDateInput.value);
chronoState.dayDuration = clamp(parseFloat(dayDurationInput.value), 0.1, 600);
updateDayDurationLabel();
updateSimDateTime();
renderBottomTimeline();
