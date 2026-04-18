import { SAVE_VERSION, STORAGE_KEY } from '../core/constants.js';
import { dom, state } from '../core/state.js';
import {
	normalizeFrontlineFx,
	serializeFrontlineFx,
	syncFrontlineFxDom
} from '../effects/frontlineEffects.js';
import {
	clamp,
	formatDateForInput,
	normalizeUnitType,
	sanitizeStrength
} from '../core/utils.js';
import {
	clearSelection,
	setCurrentTime,
	setDuration,
	setPlaying,
	setTimelineSnapConfig,
	setUnitTypeSelection,
	updateDayDurationLabel,
	updateTimelineSnapUi,
	updateSimDateTime
} from './simulation.js';

export function setSaveStatus(message, isError = false) {
	if (!dom.saveStatus) return;
	dom.saveStatus.textContent = message;
	dom.saveStatus.style.color = isError ? '#ff8f8f' : '#9ba4b7';
}

function serializeUnit(unit) {
	return {
		id: unit.id,
		x: unit.x,
		y: unit.y,
		radius: unit.radius,
		type: normalizeUnitType(unit.type),
		pathSmoothing: unit.pathSmoothing === true,
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

export function createStateSnapshot() {
	const activeFaction = parseInt(document.querySelector('input[name="faction"]:checked')?.value || '1', 10);
	return {
		version: SAVE_VERSION,
		savedAt: new Date().toISOString(),
		nextUnitId: state.nextUnitId,
		camera: {
			x: state.camera.x,
			y: state.camera.y,
			zoom: state.camera.zoom
		},
		animation: {
			currentTime: state.animation.currentTime,
			duration: state.animation.duration,
			speed: state.animation.speed,
			loop: state.animation.loop
		},
		chrono: {
			startDateMsUtc: state.chrono.startDateMsUtc,
			dayDuration: state.chrono.dayDuration
		},
		timelineSnap: {
			enabled: !!state.timelineSnap.enabled,
			stepValue: state.timelineSnap.stepValue,
			stepUnit: state.timelineSnap.stepUnit,
			autoKeyEnabled: !!state.timelineSnap.autoKeyEnabled
		},
		settings: {
			smooth: parseFloat(dom.smoothInput.value),
			frontWidth: parseFloat(dom.frontWidthInput.value),
			areaOpacity: parseFloat(dom.areaOpacityInput.value),
			frontLineColor: dom.frontLineColorInput.value,
			iconSize: state.unitIconSize,
			defaultUnitType: state.defaultUnitType,
			factionDefaultRadius: { ...state.factionDefaultRadius },
			factionDefaultStrength: { ...state.factionDefaultStrength },
			effects: serializeFrontlineFx(state.fx),
			activeFaction: activeFaction === 2 ? 2 : 1
		},
		units1: state.units1.map(serializeUnit),
		units2: state.units2.map(serializeUnit)
	};
}

function normalizeUnit(raw, fallbackId) {
	const fallbackX = state.mapWidth * 0.5;
	const fallbackY = state.mapHeight * 0.5;
	const fallbackRadius = 70;
	const fallbackStrength = 70;

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
		pathSmoothing: raw?.pathSmoothing === true,
		strength: sanitizeStrength(raw?.strength ?? strengthKeyframes[strengthKeyframes.length - 1].strength),
		keyframes,
		strengthKeyframes
	};
}

export function applyStateSnapshot(snapshot, sourceLabel = 'данных') {
	if (!snapshot || typeof snapshot !== 'object') {
		throw new Error('Некорректный формат сохранения');
	}

	const loadedUnits1Raw = Array.isArray(snapshot.units1) ? snapshot.units1 : [];
	const loadedUnits2Raw = Array.isArray(snapshot.units2) ? snapshot.units2 : [];
	const loadedUnits1 = loadedUnits1Raw.map((u, index) => normalizeUnit(u, index + 1));
	const loadedUnits2 = loadedUnits2Raw.map((u, index) => normalizeUnit(u, loadedUnits1.length + index + 1));

	state.units1 = loadedUnits1;
	state.units2 = loadedUnits2;

	const maxUnitId = Math.max(
		0,
		...state.units1.map((u) => u.id),
		...state.units2.map((u) => u.id)
	);

	const snapshotNextId = Number(snapshot.nextUnitId);
	state.nextUnitId = Number.isFinite(snapshotNextId) ? Math.max(Math.floor(snapshotNextId), maxUnitId + 1) : (maxUnitId + 1);

	const settings = snapshot.settings || {};
	const animation = snapshot.animation || {};
	const chrono = snapshot.chrono || {};
	const timelineSnap = snapshot.timelineSnap || {};
	const cameraState = snapshot.camera || {};

	state.factionDefaultRadius[1] = Number.isFinite(Number(settings.factionDefaultRadius?.[1])) ? Number(settings.factionDefaultRadius[1]) : state.factionDefaultRadius[1];
	state.factionDefaultRadius[2] = Number.isFinite(Number(settings.factionDefaultRadius?.[2])) ? Number(settings.factionDefaultRadius[2]) : state.factionDefaultRadius[2];
	state.factionDefaultStrength[1] = sanitizeStrength(settings.factionDefaultStrength?.[1] ?? state.factionDefaultStrength[1]);
	state.factionDefaultStrength[2] = sanitizeStrength(settings.factionDefaultStrength?.[2] ?? state.factionDefaultStrength[2]);

	state.defaultUnitType = normalizeUnitType(settings.defaultUnitType || state.defaultUnitType);
	setUnitTypeSelection(state.defaultUnitType);

	state.unitIconSize = clamp(Number(settings.iconSize) || state.unitIconSize, 6, 28);
	dom.iconSizeInput.value = String(Math.round(state.unitIconSize));
	dom.iconSizeValue.textContent = `${Math.round(state.unitIconSize)} px`;

	dom.smoothInput.value = String(clamp(Number(settings.smooth) || parseFloat(dom.smoothInput.value), 0.5, 4));
	dom.frontWidthInput.value = String(clamp(Number(settings.frontWidth) || parseFloat(dom.frontWidthInput.value), 0.03, 0.24));
	dom.frontWidthValue.textContent = Number(dom.frontWidthInput.value).toFixed(2);
	const restoredAreaOpacity = Number(settings.areaOpacity);
	dom.areaOpacityInput.value = String(clamp(Number.isFinite(restoredAreaOpacity) ? restoredAreaOpacity : parseFloat(dom.areaOpacityInput.value), 0, 100));
	dom.areaOpacityValue.textContent = `${Math.round(Number(dom.areaOpacityInput.value))}%`;
	if (typeof settings.frontLineColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(settings.frontLineColor)) {
		dom.frontLineColorInput.value = settings.frontLineColor;
	}

	Object.assign(state.fx, normalizeFrontlineFx(settings.effects || {}, state.fx));
	syncFrontlineFxDom(dom, state.fx);

	const activeFaction = settings.activeFaction === 2 ? 2 : 1;
	const activeFactionInput = document.querySelector(`input[name="faction"][value="${activeFaction}"]`);
	if (activeFactionInput) activeFactionInput.checked = true;

	state.camera.x = Number.isFinite(Number(cameraState.x)) ? Number(cameraState.x) : state.camera.x;
	state.camera.y = Number.isFinite(Number(cameraState.y)) ? Number(cameraState.y) : state.camera.y;
	state.camera.zoom = clamp(Number(cameraState.zoom) || state.camera.zoom, state.camera.minZoom, state.camera.maxZoom);

	state.chrono.startDateMsUtc = Number.isFinite(Number(chrono.startDateMsUtc)) ? Number(chrono.startDateMsUtc) : state.chrono.startDateMsUtc;
	state.chrono.dayDuration = clamp(Number(chrono.dayDuration) || state.chrono.dayDuration, 0.1, 600);
	dom.startDateInput.value = formatDateForInput(state.chrono.startDateMsUtc);
	dom.dayDurationInput.value = String(state.chrono.dayDuration);
	updateDayDurationLabel();
	setTimelineSnapConfig({
		enabled: timelineSnap.enabled,
		stepValue: timelineSnap.stepValue,
		stepUnit: timelineSnap.stepUnit,
		autoKeyEnabled: timelineSnap.autoKeyEnabled
	});
	updateTimelineSnapUi();

	state.animation.speed = Number.isFinite(Number(animation.speed)) ? Number(animation.speed) : state.animation.speed;
	state.animation.loop = animation.loop !== false;
	setDuration(Number.isFinite(Number(animation.duration)) ? Number(animation.duration) : state.animation.duration);
	setCurrentTime(Number.isFinite(Number(animation.currentTime)) ? Number(animation.currentTime) : state.animation.currentTime, {
		source: 'restore',
		useSnap: false,
		autoKey: false
	});

	clearSelection();
	setPlaying(false);
	state.hasUserInteracted = true;
	state.hooks.draw();
	updateSimDateTime();

	setSaveStatus(`Загружено из ${sourceLabel}: ${state.units1.length + state.units2.length} див.`);
}

export function saveStateToLocalStorage(silent = false) {
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

export function loadStateFromLocalStorage(showMissingMessage = true) {
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

export function exportStateToJson() {
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

export function importStateFromJsonText(text) {
	const parsed = JSON.parse(text);
	applyStateSnapshot(parsed, 'JSON');
	saveStateToLocalStorage(true);
}

export function scheduleAutosave() {
	if (state.autosaveTimer !== null) {
		clearTimeout(state.autosaveTimer);
	}
	state.autosaveTimer = setTimeout(() => {
		state.autosaveTimer = null;
		saveStateToLocalStorage(true);
	}, 350);
}

export function initPersistence() {
	state.hooks.onInteraction = scheduleAutosave;
}
