import { dom, state } from '../core/state.js';
import { clamp, getFrameStep, isInteractiveTarget, parseDateInputToUtcMs, sanitizeStrength } from '../core/utils.js';
import {
	addKeyframeForSelected,
	addUnitAtScreen,
	deleteKeyframeForSelected,
	deleteUnit,
	findSelectedKeyHandleAtScreen,
	findUnitAtScreen,
	getClickThreshold,
	getMousePos,
	getSelectedUnitRef,
	getUnitList,
	markInteracted,
	screenToWorld,
	selectUnit,
	setCurrentTime,
	setDuration,
	setPlaying,
	syncUnitControls,
	upsertCurrentKeyframe,
	upsertCurrentStrengthKeyframe,
	updateDayDurationLabel,
	updateSimDateTime
} from '../engine/simulation.js';
import {
	exportStateToJson,
	importStateFromJsonText,
	loadStateFromLocalStorage,
	saveStateToLocalStorage,
	setSaveStatus
} from '../engine/persistence.js';
import { draw, drawUnitsLayer, resize } from '../render/renderer.js';
import { seekTimelineByClientX } from '../timeline/timeline.js';

export function registerControls() {
	window.addEventListener('resize', resize);

	window.addEventListener('keydown', (e) => {
		if (isInteractiveTarget(e.target)) return;

		if (e.code === 'Space') {
			e.preventDefault();
			if (e.repeat) return;
			setPlaying(!state.animation.playing);
			draw();
			return;
		}

		if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
			e.preventDefault();
			setPlaying(false);
			const delta = e.code === 'ArrowRight' ? getFrameStep(dom.timelineInput) : -getFrameStep(dom.timelineInput);
			setCurrentTime(state.animation.currentTime + delta);
			draw();
		}
	});

	dom.overlay.addEventListener('contextmenu', (e) => e.preventDefault());

	dom.overlay.addEventListener('wheel', (e) => {
		e.preventDefault();
		const pos = getMousePos(e);
		const before = screenToWorld(pos.x, pos.y);
		const scale = e.deltaY < 0 ? 1.12 : 0.89;
		state.camera.zoom = clamp(state.camera.zoom * scale, state.camera.minZoom, state.camera.maxZoom);
		const after = screenToWorld(pos.x, pos.y);
		state.camera.x += before.x - after.x;
		state.camera.y += before.y - after.y;
		markInteracted();
		draw();
	}, { passive: false });

	dom.overlay.addEventListener('mousedown', (e) => {
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
			state.pointer.mode = 'pan';
			state.pointer.startX = pos.x;
			state.pointer.startY = pos.y;
			state.pointer.startCamX = state.camera.x;
			state.pointer.startCamY = state.camera.y;
			state.pointer.moved = false;
			return;
		}

		if (e.button !== 0) return;

		setPlaying(false);

		state.pointer.mode = hit ? 'unit' : 'map';
		state.pointer.faction = hit ? hit.faction : null;
		state.pointer.index = hit ? hit.index : -1;
		state.pointer.keyIndex = -1;
		state.pointer.startX = pos.x;
		state.pointer.startY = pos.y;
		state.pointer.startCamX = state.camera.x;
		state.pointer.startCamY = state.camera.y;
		state.pointer.moved = false;

		if (hit) {
			selectUnit(hit.faction, hit.index);
			drawUnitsLayer();
			return;
		}

		if (handleHit && state.selectedUnit.faction !== null && state.selectedUnit.index >= 0) {
			state.pointer.mode = 'keyframe-handle';
			state.pointer.faction = state.selectedUnit.faction;
			state.pointer.index = state.selectedUnit.index;
			state.pointer.keyIndex = handleHit.keyIndex;
			state.pointer.startX = pos.x;
			state.pointer.startY = pos.y;
			state.pointer.startCamX = state.camera.x;
			state.pointer.startCamY = state.camera.y;
			state.pointer.moved = false;
		}
	});

	window.addEventListener('mousemove', (e) => {
		if (state.timelineScrub.active) {
			seekTimelineByClientX(e.clientX, state.timelineScrub.track || dom.timelineTrack);
			draw();
			return;
		}

		if (!state.pointer.mode) return;

		const pos = getMousePos(e);
		const travel = Math.hypot(pos.x - state.pointer.startX, pos.y - state.pointer.startY);
		if (travel > getClickThreshold()) state.pointer.moved = true;

		if (state.pointer.mode === 'pan') {
			state.camera.x = state.pointer.startCamX - (pos.x - state.pointer.startX) / state.camera.zoom;
			state.camera.y = state.pointer.startCamY - (pos.y - state.pointer.startY) / state.camera.zoom;
			markInteracted();
			draw();
			return;
		}

		if (state.pointer.mode === 'keyframe-handle') {
			const list = getUnitList(state.pointer.faction);
			const unit = list[state.pointer.index];
			if (!unit || !unit.keyframes[state.pointer.keyIndex]) return;

			const world = screenToWorld(pos.x, pos.y);
			unit.keyframes[state.pointer.keyIndex].x = world.x;
			unit.keyframes[state.pointer.keyIndex].y = world.y;
			markInteracted();
			draw();
			return;
		}

		if (state.pointer.mode !== 'unit' || state.pointer.index < 0) return;
		const list = getUnitList(state.pointer.faction);
		const unit = list[state.pointer.index];
		if (!unit) return;

		if (state.pointer.keyIndex < 0) {
			const inserted = upsertCurrentKeyframe(unit);
			state.pointer.keyIndex = inserted.index;
			if (inserted.created) {
				state.hooks.renderBottomTimeline();
			} else {
				state.hooks.updateTimelineMarkersSelection();
			}
		}

		const world = screenToWorld(pos.x, pos.y);
		const frame = unit.keyframes[state.pointer.keyIndex] || upsertCurrentKeyframe(unit).frame;
		frame.x = world.x;
		frame.y = world.y;
		unit.x = frame.x;
		unit.y = frame.y;
		markInteracted();
		draw();
	});

	window.addEventListener('mouseup', (e) => {
		if (state.timelineScrub.active && e.button === 0) {
			state.timelineScrub.active = false;
			state.timelineScrub.track = null;
		}

		if (!state.pointer.mode) return;

		const pos = getMousePos(e);
		const travel = Math.hypot(pos.x - state.pointer.startX, pos.y - state.pointer.startY);
		const isClick = travel <= getClickThreshold();

		if (state.pointer.mode === 'map' && e.button === 0 && isClick && !e.shiftKey) {
			addUnitAtScreen(pos.x, pos.y);
		}

		state.pointer.mode = null;
		state.pointer.faction = null;
		state.pointer.index = -1;
		state.pointer.keyIndex = -1;
		state.pointer.moved = false;
		syncUnitControls();
		draw();
	});

	dom.clearBtn.addEventListener('click', () => {
		setPlaying(false);
		state.units1 = [];
		state.units2 = [];
		state.selectedUnit.faction = null;
		state.selectedUnit.index = -1;
		syncUnitControls();
		state.hooks.renderBottomTimeline();
		markInteracted();
		draw();
	});

	dom.saveLocalBtn.addEventListener('click', () => {
		saveStateToLocalStorage(false);
	});

	dom.loadLocalBtn.addEventListener('click', () => {
		setPlaying(false);
		loadStateFromLocalStorage(true);
	});

	dom.exportJsonBtn.addEventListener('click', () => {
		exportStateToJson();
	});

	dom.importJsonBtn.addEventListener('click', () => {
		dom.importJsonInput.click();
	});

	dom.importJsonInput.addEventListener('change', async (event) => {
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
			dom.importJsonInput.value = '';
		}
	});

	dom.unitRadiusInput.addEventListener('input', () => {
		const unit = getSelectedUnitRef();
		if (!unit) return;
		const value = parseFloat(dom.unitRadiusInput.value);
		const inserted = upsertCurrentKeyframe(unit);
		const frame = inserted.frame;
		frame.radius = value;
		unit.radius = value;
		state.factionDefaultRadius[state.selectedUnit.faction] = value;
		dom.unitRadiusValue.textContent = `${Math.round(value)} px`;
		if (inserted.created) state.hooks.renderBottomTimeline();
		markInteracted();
		draw();
	});

	dom.iconSizeInput.addEventListener('input', () => {
		state.unitIconSize = clamp(parseFloat(dom.iconSizeInput.value), 6, 28);
		dom.iconSizeValue.textContent = `${Math.round(state.unitIconSize)} px`;
		markInteracted();
		draw();
	});

	dom.unitStrengthInput.addEventListener('input', () => {
		const unit = getSelectedUnitRef();
		if (!unit) return;

		const value = sanitizeStrength(parseFloat(dom.unitStrengthInput.value));
		const inserted = upsertCurrentStrengthKeyframe(unit);
		inserted.frame.strength = value;
		unit.strength = value;
		state.factionDefaultStrength[state.selectedUnit.faction] = value;
		dom.unitStrengthInput.value = String(value);
		dom.unitStrengthValue.textContent = `${value}`;
		if (inserted.created) {
			state.hooks.renderBottomTimeline();
		} else {
			state.hooks.updateTimelineMarkersSelection();
		}
		syncUnitControls();
		markInteracted();
		draw();
	});

	dom.unitTypeInputs.forEach((input) => {
		input.addEventListener('change', () => {
			if (!input.checked) return;

			const selectedType = input.value;
			state.defaultUnitType = selectedType;
			const unit = getSelectedUnitRef();
			if (unit) {
				unit.type = selectedType;
			}

			markInteracted();
			draw();
		});
	});

	dom.smoothInput.addEventListener('input', draw);

	dom.frontWidthInput.addEventListener('input', () => {
		dom.frontWidthValue.textContent = Number(dom.frontWidthInput.value).toFixed(2);
		draw();
	});

	dom.timelineInput.addEventListener('input', () => {
		setPlaying(false);
		setCurrentTime(parseFloat(dom.timelineInput.value));
		draw();
	});

	dom.timelineTrack.addEventListener('mousedown', (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		setPlaying(false);
		state.timelineScrub.active = true;
		state.timelineScrub.track = dom.timelineTrack;
		seekTimelineByClientX(event.clientX, dom.timelineTrack);
		draw();
	});

	dom.timelineStrengthTrack.addEventListener('mousedown', (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		setPlaying(false);
		state.timelineScrub.active = true;
		state.timelineScrub.track = dom.timelineStrengthTrack;
		seekTimelineByClientX(event.clientX, dom.timelineStrengthTrack);
		draw();
	});

	dom.durationInput.addEventListener('input', () => {
		setDuration(parseFloat(dom.durationInput.value));
		draw();
	});

	dom.startDateInput.addEventListener('input', () => {
		state.chrono.startDateMsUtc = parseDateInputToUtcMs(dom.startDateInput.value);
		updateSimDateTime();
	});

	dom.dayDurationInput.addEventListener('input', () => {
		state.chrono.dayDuration = clamp(parseFloat(dom.dayDurationInput.value), 0.1, 600);
		updateDayDurationLabel();
		updateSimDateTime();
	});

	dom.playPauseBtn.addEventListener('click', () => {
		setPlaying(!state.animation.playing);
	});

	dom.addKeyBtn.addEventListener('click', () => {
		setPlaying(false);
		addKeyframeForSelected();
	});

	dom.deleteKeyBtn.addEventListener('click', () => {
		setPlaying(false);
		deleteKeyframeForSelected();
	});
}
