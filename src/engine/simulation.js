import {
	CLICK_THRESHOLD,
	KEYFRAME_SNAP,
	KEY_HANDLE_HIT_RADIUS,
	MS_PER_DAY
} from '../core/constants.js';
import { dom, state } from '../core/state.js';
import {
	clamp,
	sanitizeStrength,
	strengthNorm,
	formatDateFromUtcMs,
	formatClockFromMinutes
} from '../core/utils.js';

export function getUnitTypeSelection() {
	const selected = dom.unitTypeInputs.find((input) => input.checked);
	return selected ? selected.value : 'circle';
}

export function setUnitTypeSelection(type) {
	const normalized = ['circle', 'rect', 'diamond'].includes(type) ? type : 'circle';
	dom.unitTypeInputs.forEach((input) => {
		input.checked = input.value === normalized;
	});
}

export function buildUnitShapePath(ctx, type, x, y, size) {
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

export function pointInsideUnitShape(type, dx, dy, size) {
	const padded = size + 4;
	if (type === 'rect') {
		return Math.abs(dx) <= padded * 1.05 && Math.abs(dy) <= padded * 0.75;
	}

	if (type === 'diamond') {
		return Math.abs(dx) + Math.abs(dy) <= padded * 1.2;
	}

	return (dx * dx + dy * dy) <= padded * padded;
}

export function updateSimDateTime() {
	const dayDuration = Math.max(0.1, state.chrono.dayDuration);
	const totalDays = state.animation.currentTime / dayDuration;
	const wholeDays = Math.floor(totalDays);
	const dayFraction = totalDays - wholeDays;
	const minutesRaw = Math.round(dayFraction * 1440);
	const minutesInDay = clamp(minutesRaw, 0, 1440);

	const currentDateMs = state.chrono.startDateMsUtc + wholeDays * MS_PER_DAY;
	dom.simDateLabel.textContent = formatDateFromUtcMs(currentDateMs);
	dom.simTimeLabel.textContent = formatClockFromMinutes(minutesInDay);
}

export function updateDayDurationLabel() {
	dom.dayDurationValue.textContent = `${state.chrono.dayDuration.toFixed(1)} c/день`;
}

export function getTimelineSnapStepSeconds() {
	const stepValue = Math.max(1, Math.round(Number(state.timelineSnap.stepValue) || 1));
	const unitSeconds = state.timelineSnap.stepUnit === 'hour'
		? Math.max(0.0001, state.chrono.dayDuration / 24)
		: Math.max(0.0001, state.chrono.dayDuration);
	return stepValue * unitSeconds;
}

export function snapTimeForTimelineEdit(timeSeconds) {
	const clampedTime = clamp(timeSeconds, 0, state.animation.duration);
	if (!state.timelineSnap.enabled) {
		return clampedTime;
	}

	const stepSeconds = getTimelineSnapStepSeconds();
	if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
		return clampedTime;
	}

	const snapped = Math.round(clampedTime / stepSeconds) * stepSeconds;
	return clamp(snapped, 0, state.animation.duration);
}

export function updateTimelineSnapUi() {
	if (!dom.timelineSnapInfo) return;
	const stepValue = Math.max(1, Math.round(Number(state.timelineSnap.stepValue) || 1));
	const unitLabel = state.timelineSnap.stepUnit === 'hour'
		? (stepValue === 1 ? 'час' : 'часа')
		: (stepValue === 1 ? 'день' : 'дня');
	const modeLabel = state.timelineSnap.enabled ? 'вкл' : 'выкл';
	dom.timelineSnapInfo.textContent = `Шаг: ${stepValue} ${unitLabel} (${modeLabel})`;
}

export function setTimelineSnapConfig({ enabled, stepValue, stepUnit, autoKeyEnabled } = {}) {
	if (enabled !== undefined) {
		state.timelineSnap.enabled = !!enabled;
	}

	if (stepValue !== undefined) {
		state.timelineSnap.stepValue = Math.max(1, Math.round(Number(stepValue) || 1));
	}

	if (stepUnit === 'hour' || stepUnit === 'day') {
		state.timelineSnap.stepUnit = stepUnit;
	}

	if (autoKeyEnabled !== undefined) {
		state.timelineSnap.autoKeyEnabled = !!autoKeyEnabled;
	}

	if (dom.timelineSnapEnabledInput) {
		dom.timelineSnapEnabledInput.checked = state.timelineSnap.enabled;
	}

	if (dom.timelineSnapStepValueInput) {
		dom.timelineSnapStepValueInput.value = String(state.timelineSnap.stepValue);
	}

	if (dom.timelineSnapUnitInput) {
		dom.timelineSnapUnitInput.value = state.timelineSnap.stepUnit;
	}

	if (dom.timelineAutoKeyEnabledInput) {
		dom.timelineAutoKeyEnabledInput.checked = state.timelineSnap.autoKeyEnabled;
	}

	updateTimelineSnapUi();
}

export function markInteracted() {
	state.hasUserInteracted = true;
	state.hooks.onInteraction();
}

export function getUnitList(faction) {
	return faction === 1 ? state.units1 : state.units2;
}

function getUnitIndexById(faction, unitId) {
	const list = getUnitList(faction);
	return list.findIndex((unit) => unit.id === unitId);
}

function normalizeSelectionEntries(entries) {
	const unique = [];
	const seen = new Set();
	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i];
		if (!entry) continue;
		const faction = entry.faction === 2 ? 2 : 1;
		const list = getUnitList(faction);
		const unit = list[entry.index];
		if (!unit) continue;
		const key = `${faction}:${unit.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push({ faction, id: unit.id });
	}
	return unique;
}

function syncPrimarySelection() {
	if (state.selectedUnits.length === 0) {
		state.selectedUnit.faction = null;
		state.selectedUnit.index = -1;
		return;
	}

	const primaryFaction = state.selectedUnit.faction;
	const primaryIndex = state.selectedUnit.index;
	if (primaryFaction !== null && primaryIndex >= 0) {
		const primaryList = getUnitList(primaryFaction);
		const primaryUnit = primaryList[primaryIndex];
		if (primaryUnit) {
			const stillSelected = state.selectedUnits.some((entry) => entry.faction === primaryFaction && entry.id === primaryUnit.id);
			if (stillSelected) return;
		}
	}

	const fallback = state.selectedUnits[0];
	const idx = getUnitIndexById(fallback.faction, fallback.id);
	state.selectedUnit.faction = idx >= 0 ? fallback.faction : null;
	state.selectedUnit.index = idx;
}

export function setSelectedUnits(entries, primaryEntry = null) {
	state.selectedUnits = normalizeSelectionEntries(entries);

	if (primaryEntry) {
		const faction = primaryEntry.faction === 2 ? 2 : 1;
		const list = getUnitList(faction);
		const unit = list[primaryEntry.index];
		if (unit) {
			const isInSelection = state.selectedUnits.some((entry) => entry.faction === faction && entry.id === unit.id);
			if (isInSelection) {
				state.selectedUnit.faction = faction;
				state.selectedUnit.index = primaryEntry.index;
			}
		}
	}

	syncPrimarySelection();
	syncUnitControls();
	state.hooks.renderBottomTimeline();
}

export function getSelectedUnits() {
	const resolved = [];
	for (let i = 0; i < state.selectedUnits.length; i += 1) {
		const entry = state.selectedUnits[i];
		const index = getUnitIndexById(entry.faction, entry.id);
		if (index < 0) continue;
		resolved.push({
			faction: entry.faction,
			index,
			unit: getUnitList(entry.faction)[index]
		});
	}
	return resolved;
}

export function isUnitSelected(faction, index) {
	const list = getUnitList(faction);
	const unit = list[index];
	if (!unit) return false;
	return state.selectedUnits.some((entry) => entry.faction === faction && entry.id === unit.id);
}

export function getSelectedUnitRef() {
	if (state.selectedUnit.faction === null || state.selectedUnit.index < 0) {
		syncPrimarySelection();
	}
	if (state.selectedUnit.faction === null || state.selectedUnit.index < 0) return null;
	const list = getUnitList(state.selectedUnit.faction);
	return list[state.selectedUnit.index] || null;
}

export function sortKeyframes(unit) {
	unit.keyframes.sort((a, b) => a.t - b.t);
}

export function sortStrengthKeyframes(unit) {
	if (!unit.strengthKeyframes) unit.strengthKeyframes = [];
	unit.strengthKeyframes.sort((a, b) => a.t - b.t);
}

export function findKeyframeIndexNear(unit, time, epsilon = KEYFRAME_SNAP) {
	for (let i = 0; i < unit.keyframes.length; i += 1) {
		if (Math.abs(unit.keyframes[i].t - time) <= epsilon) return i;
	}
	return -1;
}

export function findStrengthKeyframeIndexNear(unit, time, epsilon = KEYFRAME_SNAP) {
	const keys = unit.strengthKeyframes || [];
	for (let i = 0; i < keys.length; i += 1) {
		if (Math.abs(keys[i].t - time) <= epsilon) return i;
	}
	return -1;
}

export function getLockedKeyIndex(unit) {
	if (!unit) return -1;
	return findKeyframeIndexNear(unit, state.animation.currentTime);
}

function catmullRom(p0, p1, p2, p3, t) {
	const t2 = t * t;
	const t3 = t2 * t;
	return 0.5 * (
		(2 * p1)
		+ (-p0 + p2) * t
		+ (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
		+ (-p0 + 3 * p1 - 3 * p2 + p3) * t3
	);
}

export function getUnitPoseAtTime(unit, time) {
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
		if (unit.pathSmoothing === true && keys.length >= 3) {
			const prev = i > 0 ? keys[i - 1] : a;
			const next = i + 2 < keys.length ? keys[i + 2] : b;
			return {
				x: catmullRom(prev.x, a.x, b.x, next.x, k),
				y: catmullRom(prev.y, a.y, b.y, next.y, k),
				radius: a.radius + (b.radius - a.radius) * k
			};
		}

		return {
			x: a.x + (b.x - a.x) * k,
			y: a.y + (b.y - a.y) * k,
			radius: a.radius + (b.radius - a.radius) * k
		};
	}

	return { x: last.x, y: last.y, radius: last.radius };
}

export function getUnitStrengthAtTime(unit, time) {
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

export function upsertKeyframeAtTime(unit, timeSeconds) {
	const t = clamp(timeSeconds, 0, state.animation.duration);
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

export function upsertCurrentKeyframe(unit) {
	return upsertKeyframeAtTime(unit, state.animation.currentTime);
}

export function upsertStrengthKeyframeAtTime(unit, timeSeconds) {
	const t = clamp(timeSeconds, 0, state.animation.duration);
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

export function upsertCurrentStrengthKeyframe(unit) {
	return upsertStrengthKeyframeAtTime(unit, state.animation.currentTime);
}

export function movePoseKeyframeToTime(unit, keyframeRef, targetTimeSeconds) {
	const keyIndex = unit.keyframes.indexOf(keyframeRef);
	if (keyIndex < 0) return null;

	const targetTime = clamp(targetTimeSeconds, 0, state.animation.duration);
	const existing = findKeyframeIndexNear(unit, targetTime);
	if (existing >= 0 && existing !== keyIndex) {
		const target = unit.keyframes[existing];
		target.x = keyframeRef.x;
		target.y = keyframeRef.y;
		target.radius = keyframeRef.radius;
		unit.keyframes.splice(keyIndex, 1);
		sortKeyframes(unit);
		return target;
	}

	keyframeRef.t = targetTime;
	sortKeyframes(unit);
	return keyframeRef;
}

export function moveStrengthKeyframeToTime(unit, keyframeRef, targetTimeSeconds) {
	const keys = unit.strengthKeyframes || [];
	const keyIndex = keys.indexOf(keyframeRef);
	if (keyIndex < 0) return null;

	const targetTime = clamp(targetTimeSeconds, 0, state.animation.duration);
	const existing = findStrengthKeyframeIndexNear(unit, targetTime);
	if (existing >= 0 && existing !== keyIndex) {
		const target = keys[existing];
		target.strength = sanitizeStrength(keyframeRef.strength);
		keys.splice(keyIndex, 1);
		sortStrengthKeyframes(unit);
		return target;
	}

	keyframeRef.t = targetTime;
	sortStrengthKeyframes(unit);
	return keyframeRef;
}

export function removeKeyframeAtTime(unit, time) {
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

export function removeStrengthKeyframeAtTime(unit, time) {
	const idx = findStrengthKeyframeIndexNear(unit, time);
	if (idx < 0) return false;

	const removed = unit.strengthKeyframes[idx];
	unit.strengthKeyframes.splice(idx, 1);
	if (unit.strengthKeyframes.length === 0) {
		unit.strength = sanitizeStrength(removed.strength);
	}
	return true;
}

export function createUnit(worldX, worldY, radius, type = state.defaultUnitType, strength = state.factionDefaultStrength[1]) {
	const sanitizedStrength = sanitizeStrength(strength);
	const unit = {
		id: state.nextUnitId,
		x: worldX,
		y: worldY,
		radius,
		type,
		pathSmoothing: false,
		strength: sanitizedStrength,
		keyframes: [],
		strengthKeyframes: []
	};
	state.nextUnitId += 1;
	unit.keyframes.push({ t: state.animation.currentTime, x: worldX, y: worldY, radius });
	unit.strengthKeyframes.push({ t: state.animation.currentTime, strength: sanitizedStrength });
	return unit;
}

export function seedInitialUnits() {
	state.units1 = [createUnit(state.mapWidth * 0.35, state.mapHeight * 0.5, 70, 'rect', state.factionDefaultStrength[1])];
	state.units2 = [createUnit(state.mapWidth * 0.65, state.mapHeight * 0.5, 70, 'diamond', state.factionDefaultStrength[2])];
}

export function fitCameraToMap() {
	const fitZoom = Math.min(dom.canvas.width / state.mapWidth, dom.canvas.height / state.mapHeight);
	state.camera.x = state.mapWidth * 0.5;
	state.camera.y = state.mapHeight * 0.5;
	state.camera.zoom = clamp(fitZoom, state.camera.minZoom, state.camera.maxZoom);
}

export function worldToScreen(x, y) {
	return {
		x: (x - state.camera.x) * state.camera.zoom + dom.canvas.width * 0.5,
		y: (y - state.camera.y) * state.camera.zoom + dom.canvas.height * 0.5
	};
}

export function screenToWorld(x, y) {
	return {
		x: (x - dom.canvas.width * 0.5) / state.camera.zoom + state.camera.x,
		y: (y - dom.canvas.height * 0.5) / state.camera.zoom + state.camera.y
	};
}

export function getMousePos(e) {
	const rect = dom.overlay.getBoundingClientRect();
	return {
		x: clamp(e.clientX - rect.left, 0, dom.canvas.width),
		y: clamp(e.clientY - rect.top, 0, dom.canvas.height)
	};
}

export function updateKeyframeMeta() {
	const selectedUnits = getSelectedUnits();
	if (selectedUnits.length === 0) {
		dom.keyframeMeta.textContent = 'Ключи выбранной: -';
		dom.addKeyBtn.disabled = true;
		dom.deleteKeyBtn.disabled = true;
		return;
	}

	if (selectedUnits.length > 1) {
		dom.keyframeMeta.textContent = `Выбрано дивизий: ${selectedUnits.length} (ключи редактируются у основной)`;
		dom.addKeyBtn.disabled = false;
		dom.deleteKeyBtn.disabled = false;
		return;
	}

	const unit = selectedUnits[0].unit;

	const poseKeyCount = unit.keyframes.length;
	const strengthKeyCount = (unit.strengthKeyframes || []).length;
	const hasCurrentPoseKey = findKeyframeIndexNear(unit, state.animation.currentTime) >= 0;
	const hasCurrentStrengthKey = findStrengthKeyframeIndexNear(unit, state.animation.currentTime) >= 0;
	const hasCurrentAnyKey = hasCurrentPoseKey || hasCurrentStrengthKey;
	dom.keyframeMeta.textContent = hasCurrentAnyKey
		? `Ключи: позиция ${poseKeyCount}, прочность ${strengthKeyCount} (есть ключ в текущем времени)`
		: `Ключи: позиция ${poseKeyCount}, прочность ${strengthKeyCount}`;
	dom.addKeyBtn.disabled = false;
	dom.deleteKeyBtn.disabled = !hasCurrentAnyKey;
}

export function syncUnitControls() {
	const selectedUnits = getSelectedUnits();
	if (selectedUnits.length === 0) {
		dom.unitRadiusInput.disabled = true;
		dom.unitRadiusValue.textContent = '-';
		dom.unitStrengthInput.disabled = true;
		dom.unitStrengthValue.textContent = '-';
		dom.unitPathSplineInput.disabled = true;
		dom.unitPathSplineInput.checked = false;
		dom.unitPathSplineInput.indeterminate = false;
		setUnitTypeSelection(state.defaultUnitType);
		updateKeyframeMeta();
		return;
	}

	if (selectedUnits.length > 1) {
		const radii = selectedUnits.map((entry) => getUnitPoseAtTime(entry.unit, state.animation.currentTime).radius);
		const strengths = selectedUnits.map((entry) => getUnitStrengthAtTime(entry.unit, state.animation.currentTime));
		const firstRadius = radii[0];
		const firstStrength = strengths[0];
		const sameRadius = radii.every((value) => Math.abs(value - firstRadius) <= 0.001);
		const sameStrength = strengths.every((value) => value === firstStrength);
		const allSplineOn = selectedUnits.every((entry) => entry.unit.pathSmoothing === true);
		const allSplineOff = selectedUnits.every((entry) => entry.unit.pathSmoothing !== true);

		dom.unitRadiusInput.disabled = false;
		dom.unitRadiusInput.value = String(Math.round(firstRadius));
		dom.unitRadiusValue.textContent = sameRadius
			? `${Math.round(firstRadius)} px`
			: `${selectedUnits.length} div.`;

		dom.unitStrengthInput.disabled = false;
		dom.unitStrengthInput.value = String(firstStrength);
		dom.unitStrengthValue.textContent = sameStrength
			? `${firstStrength}`
			: `${selectedUnits.length} div.`;

		dom.unitPathSplineInput.disabled = false;
		dom.unitPathSplineInput.checked = allSplineOn;
		dom.unitPathSplineInput.indeterminate = !allSplineOn && !allSplineOff;
		updateKeyframeMeta();
		return;
	}

	const unit = selectedUnits[0].unit;

	const pose = getUnitPoseAtTime(unit, state.animation.currentTime);
	const animatedStrength = getUnitStrengthAtTime(unit, state.animation.currentTime);
	dom.unitRadiusInput.disabled = false;
	dom.unitRadiusInput.value = String(Math.round(pose.radius));
	dom.unitRadiusValue.textContent = `${Math.round(pose.radius)} px`;
	dom.unitStrengthInput.disabled = false;
	dom.unitStrengthInput.value = String(animatedStrength);
	dom.unitStrengthValue.textContent = `${animatedStrength}`;
	dom.unitPathSplineInput.disabled = false;
	dom.unitPathSplineInput.checked = unit.pathSmoothing === true;
	dom.unitPathSplineInput.indeterminate = false;
	setUnitTypeSelection(unit.type || 'circle');
	updateKeyframeMeta();
}

export function selectUnit(faction, index) {
	setSelectedUnits([{ faction, index }], { faction, index });
}

export function clearSelection() {
	state.selectedUnit.faction = null;
	state.selectedUnit.index = -1;
	state.selectedUnits = [];
	syncUnitControls();
	state.hooks.renderBottomTimeline();
}

export function deleteUnit(faction, index) {
	const list = getUnitList(faction);
	const target = list[index];
	if (!target) return;
	const deletedId = target.id;
	list.splice(index, 1);
	state.selectedUnits = state.selectedUnits.filter((entry) => !(entry.faction === faction && entry.id === deletedId));
	syncPrimarySelection();
	syncUnitControls();

	updateKeyframeMeta();
	state.hooks.renderBottomTimeline();
}

export function setDuration(value) {
	state.animation.duration = clamp(value, 10, 600);
	dom.durationInput.value = String(state.animation.duration);
	dom.durationValue.textContent = `${Math.round(state.animation.duration)} c`;
	dom.timelineInput.max = String(state.animation.duration);

	if (state.animation.currentTime > state.animation.duration) {
		setCurrentTime(state.animation.duration, { source: 'duration-change', useSnap: false, autoKey: false });
	}

	state.hooks.renderBottomTimeline();
}

function shouldUseSnappingForSource(source, explicitUseSnap) {
	if (explicitUseSnap !== undefined) return !!explicitUseSnap;
	if (!state.timelineSnap.enabled) return false;
	return source !== 'playback' && source !== 'restore';
}

function shouldAutoCreateKeysForSource(source, explicitAutoKey) {
	if (state.timelineSnap.autoKeyEnabled !== true) return false;
	if (explicitAutoKey !== undefined) return !!explicitAutoKey;
	if (!state.timelineSnap.enabled) return false;
	return source !== 'playback' && source !== 'restore';
}

function ensureAutoKeysForAllUnitsBetween(prevTime, nextTime) {
	const stepSeconds = getTimelineSnapStepSeconds();
	if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return false;

	const epsilon = 0.000001;
	const minTime = Math.max(0, Math.min(prevTime, nextTime));
	const maxTime = Math.min(state.animation.duration, Math.max(prevTime, nextTime));
	if (maxTime - minTime < epsilon) return false;

	const startStep = Math.floor((minTime + epsilon) / stepSeconds) + 1;
	const endStep = Math.floor((maxTime + epsilon) / stepSeconds);
	if (endStep < startStep) return false;

	const stepIndices = [];
	for (let step = startStep; step <= endStep; step += 1) {
		stepIndices.push(step);
	}
	if (nextTime < prevTime) {
		stepIndices.reverse();
	}

	const allUnits = [...state.units1, ...state.units2];
	let createdAny = false;

	for (let i = 0; i < stepIndices.length; i += 1) {
		const t = clamp(stepIndices[i] * stepSeconds, 0, state.animation.duration);
		for (let j = 0; j < allUnits.length; j += 1) {
			const unit = allUnits[j];
			const pose = getUnitPoseAtTime(unit, t);
			const strength = getUnitStrengthAtTime(unit, t);

			const insertedPose = upsertKeyframeAtTime(unit, t);
			insertedPose.frame.x = pose.x;
			insertedPose.frame.y = pose.y;
			insertedPose.frame.radius = pose.radius;
			if (insertedPose.created) createdAny = true;

			const insertedStrength = upsertStrengthKeyframeAtTime(unit, t);
			insertedStrength.frame.strength = strength;
			if (insertedStrength.created) createdAny = true;
		}
	}

	return createdAny;
}

export function setCurrentTime(value, options = {}) {
	const prevTime = state.animation.currentTime;
	const source = options.source || 'manual';
	const useSnap = shouldUseSnappingForSource(source, options.useSnap);
	const candidate = clamp(value, 0, state.animation.duration);
	const nextTime = useSnap ? snapTimeForTimelineEdit(candidate) : candidate;

	if (shouldAutoCreateKeysForSource(source, options.autoKey)) {
		const created = ensureAutoKeysForAllUnitsBetween(prevTime, nextTime);
		if (created) {
			markInteracted();
			state.hooks.renderBottomTimeline();
		}
	}

	state.animation.currentTime = nextTime;
	dom.timelineInput.value = state.animation.currentTime.toFixed(1);
	dom.timelineValue.textContent = `${state.animation.currentTime.toFixed(1)} c`;
	syncUnitControls();
	state.hooks.updateTimelineCurrentLabel();
	state.hooks.updateTimelinePlayhead();
	state.hooks.updateTimelineMarkersSelection();
	updateSimDateTime();
}

export function setPlaying(playing) {
	if (state.animation.playing === playing) return;
	state.animation.playing = playing;
	dom.playPauseBtn.textContent = playing ? '⏸ Пауза' : '▶ Пуск';

	if (playing) {
		state.animation.lastTimestamp = 0;
		state.animationRaf = requestAnimationFrame(animationTick);
	} else if (state.animationRaf !== null) {
		cancelAnimationFrame(state.animationRaf);
		state.animationRaf = null;
	}
}

export function animationTick(timestamp) {
	if (!state.animation.playing) return;

	if (state.animation.lastTimestamp === 0) {
		state.animation.lastTimestamp = timestamp;
	}

	const dt = (timestamp - state.animation.lastTimestamp) / 1000;
	state.animation.lastTimestamp = timestamp;

	let nextTime = state.animation.currentTime + dt * state.animation.speed;
	if (nextTime > state.animation.duration) {
		if (state.animation.loop) {
			nextTime = nextTime % state.animation.duration;
		} else {
			nextTime = state.animation.duration;
			setPlaying(false);
		}
	}

	setCurrentTime(nextTime, { source: 'playback', useSnap: false, autoKey: false });
	state.hooks.draw();

	if (state.animation.playing) {
		state.animationRaf = requestAnimationFrame(animationTick);
	}
}

export function addKeyframeForSelected() {
	const unit = getSelectedUnitRef();
	if (!unit) return;

	const inserted = upsertCurrentKeyframe(unit);
	const frame = inserted.frame;
	const pose = getUnitPoseAtTime(unit, state.animation.currentTime);
	frame.x = pose.x;
	frame.y = pose.y;
	frame.radius = pose.radius;
	unit.x = frame.x;
	unit.y = frame.y;
	unit.radius = frame.radius;

	const strengthInserted = upsertCurrentStrengthKeyframe(unit);
	strengthInserted.frame.strength = getUnitStrengthAtTime(unit, state.animation.currentTime);

	updateKeyframeMeta();
	state.hooks.renderBottomTimeline();
	state.hooks.draw();
}

export function deleteKeyframeForSelected() {
	const unit = getSelectedUnitRef();
	if (!unit) return;

	const removedPose = removeKeyframeAtTime(unit, state.animation.currentTime);
	const removedStrength = removeStrengthKeyframeAtTime(unit, state.animation.currentTime);
	if (!removedPose && !removedStrength) {
		updateKeyframeMeta();
		return;
	}

	const pose = getUnitPoseAtTime(unit, state.animation.currentTime);
	unit.x = pose.x;
	unit.y = pose.y;
	unit.radius = pose.radius;
	unit.strength = getUnitStrengthAtTime(unit, state.animation.currentTime);

	syncUnitControls();
	state.hooks.renderBottomTimeline();
	state.hooks.draw();
}

export function addUnitAtScreen(x, y) {
	const faction = parseInt(document.querySelector('input[name="faction"]:checked').value, 10);
	const list = getUnitList(faction);
	const world = screenToWorld(x, y);
	const newUnit = createUnit(
		world.x,
		world.y,
		state.factionDefaultRadius[faction] || 70,
		state.defaultUnitType,
		state.factionDefaultStrength[faction]
	);
	list.push(newUnit);
	selectUnit(faction, list.length - 1);
	markInteracted();
}

export function findUnitAtScreen(x, y) {
	const iconSize = state.unitIconSize;

	for (let i = state.units1.length - 1; i >= 0; i -= 1) {
		const unit = state.units1[i];
		const pose = getUnitPoseAtTime(unit, state.animation.currentTime);
		const screen = worldToScreen(pose.x, pose.y);
		const dx = screen.x - x;
		const dy = screen.y - y;
		if (pointInsideUnitShape(unit.type || 'circle', dx, dy, iconSize)) {
			return { faction: 1, index: i };
		}
	}

	for (let i = state.units2.length - 1; i >= 0; i -= 1) {
		const unit = state.units2[i];
		const pose = getUnitPoseAtTime(unit, state.animation.currentTime);
		const screen = worldToScreen(pose.x, pose.y);
		const dx = screen.x - x;
		const dy = screen.y - y;
		if (pointInsideUnitShape(unit.type || 'circle', dx, dy, iconSize)) {
			return { faction: 2, index: i };
		}
	}

	return null;
}

export function findSelectedKeyHandleAtScreen(x, y) {
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

export function getClickThreshold() {
	return CLICK_THRESHOLD;
}

export function getKeyframeSnap() {
	return KEYFRAME_SNAP;
}

export function getInfluenceRadius(unit, pose) {
	const animatedStrength = getUnitStrengthAtTime(unit, state.animation.currentTime);
	return pose.radius * strengthNorm(animatedStrength);
}
