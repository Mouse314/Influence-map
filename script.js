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

const DEFAULT_ICON_SIZE = 10;
const DEFAULT_UNIT_STRENGTH = 70;
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
const factionDefaultStrength = { 1: DEFAULT_UNIT_STRENGTH, 2: DEFAULT_UNIT_STRENGTH };
let defaultUnitType = 'circle';
let unitIconSize = DEFAULT_ICON_SIZE;
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

let units1 = [];
let units2 = [];

const unitRadiusInput = document.getElementById('unitRadius');
const unitRadiusValue = document.getElementById('unitRadiusValue');
const iconSizeInput = document.getElementById('iconSize');
const iconSizeValue = document.getElementById('iconSizeValue');
const unitStrengthInput = document.getElementById('unitStrength');
const unitStrengthValue = document.getElementById('unitStrengthValue');
const unitTypeInputs = Array.from(document.querySelectorAll('input[name="unitType"]'));
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
const timelineStrengthTrack = document.getElementById('timelineStrengthTrack');
const timelineStrengthMarkers = document.getElementById('timelineStrengthMarkers');
const timelineStrengthPlayhead = document.getElementById('timelineStrengthPlayhead');
const timelineSelectedLabel = document.getElementById('timelineSelectedLabel');
const timelineCurrentLabel = document.getElementById('timelineCurrentLabel');
const simDateLabel = document.getElementById('simDate');
const simTimeLabel = document.getElementById('simTime');
const startDateInput = document.getElementById('startDate');
const dayDurationInput = document.getElementById('dayDuration');
const dayDurationValue = document.getElementById('dayDurationValue');
const saveLocalBtn = document.getElementById('saveLocalBtn');
const loadLocalBtn = document.getElementById('loadLocalBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const importJsonBtn = document.getElementById('importJsonBtn');
const importJsonInput = document.getElementById('importJsonInput');
const saveStatus = document.getElementById('saveStatus');

let timelineScrubActive = false;
let timelineScrubTrack = null;

const STORAGE_KEY = 'influence-map-state-v1';
const SAVE_VERSION = 1;
let autosaveTimer = null;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const chronoState = {
startDateMsUtc: Date.UTC(1941, 0, 1),
dayDuration: 12
};

function clamp(value, min, max) {
return Math.max(min, Math.min(max, value));
}

function sanitizeStrength(value) {
const numeric = Number(value);
if (!Number.isFinite(numeric)) return DEFAULT_UNIT_STRENGTH;
return Math.round(clamp(numeric, 1, 100));
}

function strengthNorm(value) {
return sanitizeStrength(value) / 100;
}

function getUnitTypeSelection() {
const selected = unitTypeInputs.find((input) => input.checked);
return selected ? selected.value : 'circle';
}

function setUnitTypeSelection(type) {
const normalized = ['circle', 'rect', 'diamond'].includes(type) ? type : 'circle';
unitTypeInputs.forEach((input) => {
input.checked = input.value === normalized;
});
}

function buildUnitShapePath(ctx, type, x, y, size) {
ctx.beginPath();
if (type === 'rect') {
const width = size * 2.1;
const height = size * 1.45;
ctx.rect(x - width * 0.5, y - height * 0.5, width, height);
return;
}

if (type === 'diamond') {
const half = size * 1.15;
ctx.moveTo(x, y - half);
ctx.lineTo(x + half, y);
ctx.lineTo(x, y + half);
ctx.lineTo(x - half, y);
ctx.closePath();
return;
}

ctx.arc(x, y, size, 0, Math.PI * 2);
}

function pointInsideUnitShape(type, dx, dy, size) {
const padded = size + 4;
if (type === 'rect') {
return Math.abs(dx) <= padded * 1.05 && Math.abs(dy) <= padded * 0.75;
}

if (type === 'diamond') {
return Math.abs(dx) + Math.abs(dy) <= padded * 1.2;
}

return (dx * dx + dy * dy) <= padded * padded;
}

function formatSeconds(value) {
return `${value.toFixed(1)} c`;
}

function getFrameStep() {
const step = parseFloat(timelineInput.step);
if (!Number.isFinite(step) || step <= 0) return 0.1;
return step;
}

function isInteractiveTarget(target) {
if (!(target instanceof HTMLElement)) return false;
const tag = target.tagName;
return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
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

function formatDateForInput(ms) {
const d = new Date(ms);
const year = d.getUTCFullYear();
const month = String(d.getUTCMonth() + 1).padStart(2, '0');
const day = String(d.getUTCDate()).padStart(2, '0');
return `${year}-${month}-${day}`;
}

function setSaveStatus(message, isError = false) {
if (!saveStatus) return;
saveStatus.textContent = message;
saveStatus.style.color = isError ? '#ff8f8f' : '#9ba4b7';
}

function normalizeUnitType(type) {
return ['circle', 'rect', 'diamond'].includes(type) ? type : 'circle';
}

function serializeUnit(unit) {
return {
id: unit.id,
x: unit.x,
y: unit.y,
radius: unit.radius,
type: normalizeUnitType(unit.type),
strength: sanitizeStrength(unit.strength),
keyframes: (unit.keyframes || []).map((k) => ({
t: Number(k.t),
x: Number(k.x),
y: Number(k.y),
radius: Number(k.radius)
})),
strengthKeyframes: (unit.strengthKeyframes || []).map((k) => ({
t: Number(k.t),
strength: sanitizeStrength(k.strength)
}))
};
}

function createStateSnapshot() {
const activeFaction = parseInt(document.querySelector('input[name="faction"]:checked')?.value || '1', 10);
return {
version: SAVE_VERSION,
savedAt: new Date().toISOString(),
nextUnitId,
camera: {
x: camera.x,
y: camera.y,
zoom: camera.zoom
},
animation: {
currentTime: animationState.currentTime,
duration: animationState.duration,
speed: animationState.speed,
loop: animationState.loop
},
chrono: {
startDateMsUtc: chronoState.startDateMsUtc,
dayDuration: chronoState.dayDuration
},
settings: {
smooth: parseFloat(smoothInput.value),
frontWidth: parseFloat(frontWidthInput.value),
iconSize: unitIconSize,
defaultUnitType,
factionDefaultRadius: { ...factionDefaultRadius },
factionDefaultStrength: { ...factionDefaultStrength },
activeFaction: activeFaction === 2 ? 2 : 1
},
units1: units1.map(serializeUnit),
units2: units2.map(serializeUnit)
};
}

function normalizeUnit(raw, fallbackId) {
const fallbackX = mapWidth * 0.5;
const fallbackY = mapHeight * 0.5;
const fallbackRadius = 70;
const fallbackStrength = DEFAULT_UNIT_STRENGTH;

const keyframesRaw = Array.isArray(raw?.keyframes) ? raw.keyframes : [];
const keyframes = keyframesRaw.map((k) => ({
t: Number(k.t),
x: Number(k.x),
y: Number(k.y),
radius: Number(k.radius)
})).filter((k) => Number.isFinite(k.t)
&& Number.isFinite(k.x)
&& Number.isFinite(k.y)
&& Number.isFinite(k.radius));

if (keyframes.length === 0) {
const unitX = Number.isFinite(Number(raw?.x)) ? Number(raw.x) : fallbackX;
const unitY = Number.isFinite(Number(raw?.y)) ? Number(raw.y) : fallbackY;
const unitRadius = Number.isFinite(Number(raw?.radius)) ? Number(raw.radius) : fallbackRadius;
keyframes.push({ t: 0, x: unitX, y: unitY, radius: unitRadius });
}

keyframes.sort((a, b) => a.t - b.t);

const strengthKeyframesRaw = Array.isArray(raw?.strengthKeyframes) ? raw.strengthKeyframes : [];
const strengthKeyframes = strengthKeyframesRaw.map((k) => ({
t: Number(k.t),
strength: sanitizeStrength(k.strength)
})).filter((k) => Number.isFinite(k.t));

if (strengthKeyframes.length === 0) {
strengthKeyframes.push({
t: keyframes[0].t,
strength: sanitizeStrength(raw?.strength ?? fallbackStrength)
});
}

strengthKeyframes.sort((a, b) => a.t - b.t);

return {
id: Number.isFinite(Number(raw?.id)) ? Math.max(1, Math.floor(Number(raw.id))) : fallbackId,
x: keyframes[0].x,
y: keyframes[0].y,
radius: keyframes[0].radius,
type: normalizeUnitType(raw?.type),
strength: sanitizeStrength(raw?.strength ?? strengthKeyframes[strengthKeyframes.length - 1].strength),
keyframes,
strengthKeyframes
};
}

function applyStateSnapshot(snapshot, sourceLabel = 'данных') {
if (!snapshot || typeof snapshot !== 'object') {
throw new Error('Некорректный формат сохранения');
}

const loadedUnits1Raw = Array.isArray(snapshot.units1) ? snapshot.units1 : [];
const loadedUnits2Raw = Array.isArray(snapshot.units2) ? snapshot.units2 : [];
const loadedUnits1 = loadedUnits1Raw.map((u, index) => normalizeUnit(u, index + 1));
const loadedUnits2 = loadedUnits2Raw.map((u, index) => normalizeUnit(u, loadedUnits1.length + index + 1));

units1 = loadedUnits1;
units2 = loadedUnits2;

const maxUnitId = Math.max(
0,
...units1.map((u) => u.id),
...units2.map((u) => u.id)
);

const snapshotNextId = Number(snapshot.nextUnitId);
nextUnitId = Number.isFinite(snapshotNextId) ? Math.max(Math.floor(snapshotNextId), maxUnitId + 1) : (maxUnitId + 1);

const settings = snapshot.settings || {};
const animation = snapshot.animation || {};
const chrono = snapshot.chrono || {};
const cameraState = snapshot.camera || {};

factionDefaultRadius[1] = Number.isFinite(Number(settings.factionDefaultRadius?.[1])) ? Number(settings.factionDefaultRadius[1]) : factionDefaultRadius[1];
factionDefaultRadius[2] = Number.isFinite(Number(settings.factionDefaultRadius?.[2])) ? Number(settings.factionDefaultRadius[2]) : factionDefaultRadius[2];
factionDefaultStrength[1] = sanitizeStrength(settings.factionDefaultStrength?.[1] ?? factionDefaultStrength[1]);
factionDefaultStrength[2] = sanitizeStrength(settings.factionDefaultStrength?.[2] ?? factionDefaultStrength[2]);

defaultUnitType = normalizeUnitType(settings.defaultUnitType || defaultUnitType);
setUnitTypeSelection(defaultUnitType);

unitIconSize = clamp(Number(settings.iconSize) || unitIconSize, 6, 28);
iconSizeInput.value = String(Math.round(unitIconSize));
iconSizeValue.textContent = `${Math.round(unitIconSize)} px`;

smoothInput.value = String(clamp(Number(settings.smooth) || parseFloat(smoothInput.value), 0.5, 4));
frontWidthInput.value = String(clamp(Number(settings.frontWidth) || parseFloat(frontWidthInput.value), 0.03, 0.24));
frontWidthValue.textContent = Number(frontWidthInput.value).toFixed(2);

const activeFaction = settings.activeFaction === 2 ? 2 : 1;
const activeFactionInput = document.querySelector(`input[name="faction"][value="${activeFaction}"]`);
if (activeFactionInput) activeFactionInput.checked = true;

camera.x = Number.isFinite(Number(cameraState.x)) ? Number(cameraState.x) : camera.x;
camera.y = Number.isFinite(Number(cameraState.y)) ? Number(cameraState.y) : camera.y;
camera.zoom = clamp(Number(cameraState.zoom) || camera.zoom, camera.minZoom, camera.maxZoom);

chronoState.startDateMsUtc = Number.isFinite(Number(chrono.startDateMsUtc)) ? Number(chrono.startDateMsUtc) : chronoState.startDateMsUtc;
chronoState.dayDuration = clamp(Number(chrono.dayDuration) || chronoState.dayDuration, 0.1, 600);
startDateInput.value = formatDateForInput(chronoState.startDateMsUtc);
dayDurationInput.value = String(chronoState.dayDuration);
updateDayDurationLabel();

animationState.speed = Number.isFinite(Number(animation.speed)) ? Number(animation.speed) : animationState.speed;
animationState.loop = animation.loop !== false;
setDuration(Number.isFinite(Number(animation.duration)) ? Number(animation.duration) : animationState.duration);
setCurrentTime(Number.isFinite(Number(animation.currentTime)) ? Number(animation.currentTime) : animationState.currentTime);

clearSelection();
setPlaying(false);
hasUserInteracted = true;
draw();

setSaveStatus(`Загружено из ${sourceLabel}: ${units1.length + units2.length} див.`);
}

function saveStateToLocalStorage(silent = false) {
try {
localStorage.setItem(STORAGE_KEY, JSON.stringify(createStateSnapshot()));
if (!silent) {
setSaveStatus(`Сохранено в браузер: ${new Date().toLocaleTimeString('ru-RU')}`);
}
return true;
} catch (error) {
setSaveStatus(`Ошибка сохранения: ${error.message}`, true);
return false;
}
}

function loadStateFromLocalStorage(showMissingMessage = true) {
try {
const raw = localStorage.getItem(STORAGE_KEY);
if (!raw) {
if (showMissingMessage) {
setSaveStatus('В браузере нет сохраненного состояния');
}
return false;
}
const parsed = JSON.parse(raw);
applyStateSnapshot(parsed, 'браузера');
return true;
} catch (error) {
setSaveStatus(`Ошибка загрузки: ${error.message}`, true);
return false;
}
}

function exportStateToJson() {
const snapshot = createStateSnapshot();
const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = `influence-map-${Date.now()}.json`;
document.body.appendChild(link);
link.click();
link.remove();
URL.revokeObjectURL(url);
setSaveStatus('JSON экспортирован');
}

function importStateFromJsonText(text) {
const parsed = JSON.parse(text);
applyStateSnapshot(parsed, 'JSON');
saveStateToLocalStorage(true);
}

function scheduleAutosave() {
if (autosaveTimer !== null) {
clearTimeout(autosaveTimer);
}
autosaveTimer = setTimeout(() => {
autosaveTimer = null;
saveStateToLocalStorage(true);
}, 350);
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
const left = `${timeToPercent(animationState.currentTime)}%`;
timelinePlayhead.style.left = left;
timelineStrengthPlayhead.style.left = left;
}

function updateTimelineMarkersSelection() {
const markers = timelineDock.querySelectorAll('.timeline-marker');
markers.forEach((marker) => {
const t = parseFloat(marker.dataset.time);
const isActive = Math.abs(t - animationState.currentTime) <= KEYFRAME_SNAP;
marker.classList.toggle('active', isActive);
});
}

function appendTimelineMarker(container, time, titlePrefix, markerClass = '') {
const marker = document.createElement('button');
marker.type = 'button';
marker.className = markerClass ? `timeline-marker ${markerClass}` : 'timeline-marker';
marker.style.left = `${timeToPercent(time)}%`;
marker.dataset.time = time.toFixed(4);
marker.title = `${titlePrefix}: ${formatSeconds(time)}`;
if (Math.abs(time - animationState.currentTime) <= KEYFRAME_SNAP) {
marker.classList.add('active');
}

marker.addEventListener('mousedown', (event) => {
event.stopPropagation();
});

marker.addEventListener('click', (event) => {
event.stopPropagation();
setPlaying(false);
setCurrentTime(time);
draw();
});

container.appendChild(marker);
}

function renderBottomTimeline() {
const unit = getSelectedUnitRef();
timelineMarkers.innerHTML = '';
timelineStrengthMarkers.innerHTML = '';

if (!unit) {
timelineSelectedLabel.textContent = 'Выберите дивизию, чтобы увидеть ее ключи';
updateTimelinePlayhead();
updateTimelineCurrentLabel();
return;
}

const strengthKeys = unit.strengthKeyframes || [];
timelineSelectedLabel.textContent = `Дивизия: позиция ${unit.keyframes.length}, прочность ${strengthKeys.length}`;

const sorted = [...unit.keyframes].sort((a, b) => a.t - b.t);
for (let i = 0; i < sorted.length; i += 1) {
const key = sorted[i];
appendTimelineMarker(timelineMarkers, key.t, 'Кадр позиции');
}

const sortedStrength = [...strengthKeys].sort((a, b) => a.t - b.t);
for (let i = 0; i < sortedStrength.length; i += 1) {
appendTimelineMarker(timelineStrengthMarkers, sortedStrength[i].t, 'Кадр прочности', 'strength-marker');
}

updateTimelinePlayhead();
updateTimelineCurrentLabel();
}

function seekTimelineByClientX(clientX, trackElement = timelineTrack) {
const rect = trackElement.getBoundingClientRect();
const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
setCurrentTime(animationState.duration * ratio);
}

function markInteracted() {
hasUserInteracted = true;
scheduleAutosave();
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

function sortStrengthKeyframes(unit) {
if (!unit.strengthKeyframes) unit.strengthKeyframes = [];
unit.strengthKeyframes.sort((a, b) => a.t - b.t);
}

function findKeyframeIndexNear(unit, time, epsilon = KEYFRAME_SNAP) {
for (let i = 0; i < unit.keyframes.length; i += 1) {
if (Math.abs(unit.keyframes[i].t - time) <= epsilon) return i;
}
return -1;
}

function findStrengthKeyframeIndexNear(unit, time, epsilon = KEYFRAME_SNAP) {
const keys = unit.strengthKeyframes || [];
for (let i = 0; i < keys.length; i += 1) {
if (Math.abs(keys[i].t - time) <= epsilon) return i;
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

function getUnitStrengthAtTime(unit, time) {
const fallback = sanitizeStrength(unit.strength);
const keys = unit.strengthKeyframes || [];

if (keys.length === 0) {
return fallback;
}

if (keys.length === 1) {
return sanitizeStrength(keys[0].strength);
}

if (time <= keys[0].t) {
return sanitizeStrength(keys[0].strength);
}

const last = keys[keys.length - 1];
if (time >= last.t) {
return sanitizeStrength(last.strength);
}

for (let i = 0; i < keys.length - 1; i += 1) {
const a = keys[i];
const b = keys[i + 1];
if (time < a.t || time > b.t) continue;

const span = Math.max(0.00001, b.t - a.t);
const k = clamp((time - a.t) / span, 0, 1);
return sanitizeStrength(a.strength + (b.strength - a.strength) * k);
}

return sanitizeStrength(last.strength);
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

function upsertCurrentStrengthKeyframe(unit) {
const t = clamp(animationState.currentTime, 0, animationState.duration);
if (!unit.strengthKeyframes) unit.strengthKeyframes = [];

const existing = findStrengthKeyframeIndexNear(unit, t);
if (existing >= 0) {
return { frame: unit.strengthKeyframes[existing], index: existing, created: false };
}

const frame = { t, strength: getUnitStrengthAtTime(unit, t) };
unit.strengthKeyframes.push(frame);
sortStrengthKeyframes(unit);
return {
frame,
index: unit.strengthKeyframes.indexOf(frame),
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

function removeStrengthKeyframeAtTime(unit, time) {
const idx = findStrengthKeyframeIndexNear(unit, time);
if (idx < 0) return false;

const removed = unit.strengthKeyframes[idx];
unit.strengthKeyframes.splice(idx, 1);
if (unit.strengthKeyframes.length === 0) {
unit.strength = sanitizeStrength(removed.strength);
}
return true;
}

function createUnit(worldX, worldY, radius, type = defaultUnitType, strength = DEFAULT_UNIT_STRENGTH) {
const sanitizedStrength = sanitizeStrength(strength);
const unit = {
id: nextUnitId,
x: worldX,
y: worldY,
radius,
type,
strength: sanitizedStrength,
keyframes: [],
strengthKeyframes: []
};
nextUnitId += 1;
unit.keyframes.push({ t: animationState.currentTime, x: worldX, y: worldY, radius });
unit.strengthKeyframes.push({ t: animationState.currentTime, strength: sanitizedStrength });
return unit;
}

function seedInitialUnits() {
units1 = [createUnit(mapWidth * 0.35, mapHeight * 0.5, 70, 'rect', factionDefaultStrength[1])];
units2 = [createUnit(mapWidth * 0.65, mapHeight * 0.5, 70, 'diamond', factionDefaultStrength[2])];
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

const poseKeyCount = unit.keyframes.length;
const strengthKeyCount = (unit.strengthKeyframes || []).length;
const hasCurrentPoseKey = findKeyframeIndexNear(unit, animationState.currentTime) >= 0;
const hasCurrentStrengthKey = findStrengthKeyframeIndexNear(unit, animationState.currentTime) >= 0;
const hasCurrentAnyKey = hasCurrentPoseKey || hasCurrentStrengthKey;
keyframeMeta.textContent = hasCurrentAnyKey
? `Ключи: позиция ${poseKeyCount}, прочность ${strengthKeyCount} (есть ключ в текущем времени)`
: `Ключи: позиция ${poseKeyCount}, прочность ${strengthKeyCount}`;
addKeyBtn.disabled = false;
deleteKeyBtn.disabled = !hasCurrentAnyKey;
}

function syncUnitRadiusControl() {
const unit = getSelectedUnitRef();
if (!unit) {
unitRadiusInput.disabled = true;
unitRadiusValue.textContent = '-';
unitStrengthInput.disabled = true;
unitStrengthValue.textContent = '-';
setUnitTypeSelection(defaultUnitType);
updateKeyframeMeta();
return;
}

const pose = getUnitPoseAtTime(unit, animationState.currentTime);
const animatedStrength = getUnitStrengthAtTime(unit, animationState.currentTime);
unitRadiusInput.disabled = false;
unitRadiusInput.value = String(Math.round(pose.radius));
unitRadiusValue.textContent = `${Math.round(pose.radius)} px`;
unitStrengthInput.disabled = false;
unitStrengthInput.value = String(animatedStrength);
unitStrengthValue.textContent = `${animatedStrength}`;
setUnitTypeSelection(unit.type || 'circle');
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

const strengthInserted = upsertCurrentStrengthKeyframe(unit);
strengthInserted.frame.strength = getUnitStrengthAtTime(unit, animationState.currentTime);

updateKeyframeMeta();
renderBottomTimeline();
draw();
}

function deleteKeyframeForSelected() {
const unit = getSelectedUnitRef();
if (!unit) return;

const removedPose = removeKeyframeAtTime(unit, animationState.currentTime);
const removedStrength = removeStrengthKeyframeAtTime(unit, animationState.currentTime);
if (!removedPose && !removedStrength) {
updateKeyframeMeta();
return;
}

const pose = getUnitPoseAtTime(unit, animationState.currentTime);
unit.x = pose.x;
unit.y = pose.y;
unit.radius = pose.radius;
unit.strength = getUnitStrengthAtTime(unit, animationState.currentTime);

syncUnitRadiusControl();
renderBottomTimeline();
draw();
}

function addUnitAtScreen(x, y) {
const faction = parseInt(document.querySelector('input[name="faction"]:checked').value, 10);
const list = getUnitList(faction);
const world = screenToWorld(x, y);
const newUnit = createUnit(
world.x,
world.y,
factionDefaultRadius[faction] || 70,
defaultUnitType,
factionDefaultStrength[faction] || DEFAULT_UNIT_STRENGTH
);
list.push(newUnit);
selectUnit(faction, list.length - 1);
markInteracted();
}

function findUnitAtScreen(x, y) {
const iconSize = unitIconSize;

for (let i = units1.length - 1; i >= 0; i -= 1) {
const unit = units1[i];
const pose = getUnitPoseAtTime(unit, animationState.currentTime);
const screen = worldToScreen(pose.x, pose.y);
const dx = screen.x - x;
const dy = screen.y - y;
if (pointInsideUnitShape(unit.type || 'circle', dx, dy, iconSize)) {
return { faction: 1, index: i };
}
}

for (let i = units2.length - 1; i >= 0; i -= 1) {
const unit = units2[i];
const pose = getUnitPoseAtTime(unit, animationState.currentTime);
const screen = worldToScreen(pose.x, pose.y);
const dx = screen.x - x;
const dy = screen.y - y;
if (pointInsideUnitShape(unit.type || 'circle', dx, dy, iconSize)) {
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
const animatedStrength = getUnitStrengthAtTime(unit, animationState.currentTime);
const pos = worldToScreen(pose.x, pose.y);
if (pos.x < -36 || pos.y < -36 || pos.x > overlay.width + 36 || pos.y > overlay.height + 36) return;

const isSelected = selectedUnit.faction === faction && selectedUnit.index === index;
buildUnitShapePath(overlayCtx, unit.type || 'circle', pos.x, pos.y, unitIconSize);
overlayCtx.fillStyle = fillColor;
overlayCtx.fill();
overlayCtx.lineWidth = isSelected ? 3 : 2;
overlayCtx.strokeStyle = isSelected ? '#fff5a3' : strokeColor;
overlayCtx.stroke();

const strength = sanitizeStrength(animatedStrength);
const fontSize = clamp(Math.round(unitIconSize * 0.85), 9, 14);
overlayCtx.font = `700 ${fontSize}px Segoe UI, Tahoma, Geneva, Verdana, sans-serif`;
overlayCtx.textAlign = 'center';
overlayCtx.textBaseline = 'middle';
overlayCtx.lineWidth = 3;
overlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
overlayCtx.strokeText(String(strength), pos.x, pos.y + 0.5);
overlayCtx.fillStyle = '#f8f8f8';
overlayCtx.fillText(String(strength), pos.x, pos.y + 0.5);
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
const animatedStrength = getUnitStrengthAtTime(units[i], animationState.currentTime);
const influenceRadius = pose.radius * strengthNorm(animatedStrength);
const k = i * 4;
buffer[k] = pose.x;
buffer[k + 1] = pose.y;
buffer[k + 2] = influenceRadius;
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
if (isInteractiveTarget(e.target)) return;

if (e.code === 'Space') {
e.preventDefault();
if (e.repeat) return;
setPlaying(!animationState.playing);
draw();
return;
}

if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
e.preventDefault();
setPlaying(false);
const delta = e.code === 'ArrowRight' ? getFrameStep() : -getFrameStep();
setCurrentTime(animationState.currentTime + delta);
draw();
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
const handleHit = e.button === 0 && !e.shiftKey ? findSelectedKeyHandleAtScreen(pos.x, pos.y) : null;
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

if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
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
seekTimelineByClientX(e.clientX, timelineScrubTrack || timelineTrack);
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
timelineScrubTrack = null;
}

if (!pointerState.mode) return;

const pos = getMousePos(e);
const travel = Math.hypot(pos.x - pointerState.startX, pos.y - pointerState.startY);
const isClick = travel <= CLICK_THRESHOLD;

if (pointerState.mode === 'map' && e.button === 0 && isClick && !e.shiftKey) {
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

saveLocalBtn.addEventListener('click', () => {
saveStateToLocalStorage(false);
});

loadLocalBtn.addEventListener('click', () => {
setPlaying(false);
loadStateFromLocalStorage(true);
});

exportJsonBtn.addEventListener('click', () => {
exportStateToJson();
});

importJsonBtn.addEventListener('click', () => {
importJsonInput.click();
});

importJsonInput.addEventListener('change', async (event) => {
const file = event.target.files && event.target.files[0];
if (!file) return;

try {
setPlaying(false);
const text = await file.text();
importStateFromJsonText(text);
setSaveStatus(`Импортировано из ${file.name}`);
} catch (error) {
setSaveStatus(`Ошибка импорта: ${error.message}`, true);
} finally {
importJsonInput.value = '';
}
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

iconSizeInput.addEventListener('input', () => {
unitIconSize = clamp(parseFloat(iconSizeInput.value), 6, 28);
iconSizeValue.textContent = `${Math.round(unitIconSize)} px`;
markInteracted();
draw();
});

unitStrengthInput.addEventListener('input', () => {
const unit = getSelectedUnitRef();
if (!unit) return;

const value = sanitizeStrength(parseFloat(unitStrengthInput.value));
const inserted = upsertCurrentStrengthKeyframe(unit);
inserted.frame.strength = value;
unit.strength = value;
factionDefaultStrength[selectedUnit.faction] = value;
unitStrengthInput.value = String(value);
unitStrengthValue.textContent = `${value}`;
if (inserted.created) {
renderBottomTimeline();
} else {
updateTimelineMarkersSelection();
updateKeyframeMeta();
}
markInteracted();
draw();
});

unitTypeInputs.forEach((input) => {
input.addEventListener('change', () => {
if (!input.checked) return;

const selectedType = input.value;
defaultUnitType = selectedType;
const unit = getSelectedUnitRef();
if (unit) {
unit.type = selectedType;
}

markInteracted();
draw();
});
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
timelineScrubTrack = timelineTrack;
seekTimelineByClientX(event.clientX, timelineTrack);
draw();
});

timelineStrengthTrack.addEventListener('mousedown', (event) => {
if (event.button !== 0) return;
event.preventDefault();
setPlaying(false);
timelineScrubActive = true;
timelineScrubTrack = timelineStrengthTrack;
seekTimelineByClientX(event.clientX, timelineStrengthTrack);
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
unitIconSize = clamp(parseFloat(iconSizeInput.value), 6, 28);
iconSizeValue.textContent = `${Math.round(unitIconSize)} px`;
defaultUnitType = getUnitTypeSelection();
syncUnitRadiusControl();
frontWidthValue.textContent = Number(frontWidthInput.value).toFixed(2);
chronoState.startDateMsUtc = parseDateInputToUtcMs(startDateInput.value);
chronoState.dayDuration = clamp(parseFloat(dayDurationInput.value), 0.1, 600);
updateDayDurationLabel();
updateSimDateTime();
renderBottomTimeline();

if (!loadStateFromLocalStorage(false)) {
setSaveStatus('Состояние сохранения: нет данных');
}
