import { dom, mapImage, state } from '../core/state.js';
import { clamp, getFrameStep, isInteractiveTarget, parseDateInputToUtcMs, sanitizeStrength } from '../core/utils.js';
import {
	addKeyframeForSelected,
	addUnitAtScreen,
	clearSelection,
	deleteKeyframeForSelected,
	deleteUnit,
	findSelectedKeyHandleAtScreen,
	findUnitAtScreen,
	getClickThreshold,
	getUnitPoseAtTime,
	getTimelineSnapStepSeconds,
	getMousePos,
	getSelectedUnitRef,
	getSelectedUnits,
	getUnitList,
	isUnitSelected,
	markInteracted,
	screenToWorld,
	selectUnit,
	setSelectedUnits,
	setCurrentTime,
	setDuration,
	setPlaying,
	setTimelineSnapConfig,
	syncUnitControls,
	upsertCurrentKeyframe,
	upsertCurrentStrengthKeyframe,
	updateDayDurationLabel,
	updateTimelineSnapUi,
	updateSimDateTime,
	worldToScreen
} from '../engine/simulation.js';
import {
	exportStateToJson,
	importStateFromJsonText,
	loadStateFromLocalStorage,
	saveStateToLocalStorage,
	setSaveStatus
} from '../engine/persistence.js';
import { pullFrontlineFxFromDom, syncFrontlineFxDom } from '../effects/frontlineEffects.js';
import { draw, drawUnitsLayer, resize } from '../render/renderer.js';
import { seekTimelineByClientX } from '../timeline/timeline.js';

let pastedMapObjectUrl = null;

export function registerControls() {
	syncFrontlineFxDom(dom, state.fx);
	setTimelineSnapConfig({
		enabled: dom.timelineSnapEnabledInput.checked,
		stepValue: parseInt(dom.timelineSnapStepValueInput.value, 10),
		stepUnit: dom.timelineSnapUnitInput.value,
		autoKeyEnabled: dom.timelineAutoKeyEnabledInput.checked
	});

	const currentModeInput = dom.mapModeInputs.find((input) => input.checked);
	state.mapMode = currentModeInput ? currentModeInput.value : 'drag';

	function getUnitsInsideRect(x1, y1, x2, y2) {
		const minX = Math.min(x1, x2);
		const maxX = Math.max(x1, x2);
		const minY = Math.min(y1, y2);
		const maxY = Math.max(y1, y2);
		const hits = [];
		for (const faction of [1, 2]) {
			const list = getUnitList(faction);
			for (let i = 0; i < list.length; i += 1) {
				const pose = getUnitPoseAtTime(list[i], state.animation.currentTime);
				const pos = worldToScreen(pose.x, pose.y);
				if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
					hits.push({ faction, index: i });
				}
			}
		}
		return hits;
	}

	dom.mapModeInputs.forEach((input) => {
		input.addEventListener('change', () => {
			if (!input.checked) return;
			state.mapMode = input.value;
			state.pointer.mode = null;
			draw();
		});
	});

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
			if (state.timelineSnap.enabled) {
				const snapStep = getTimelineSnapStepSeconds();
				const current = state.animation.currentTime;
				const nextSlot = e.code === 'ArrowRight'
					? (Math.floor(current / snapStep) + 1) * snapStep
					: (Math.ceil(current / snapStep) - 1) * snapStep;
				setCurrentTime(nextSlot, {
					source: 'keyboard-step',
					useSnap: false
				});
			} else {
				const delta = e.code === 'ArrowRight' ? getFrameStep(dom.timelineInput) : -getFrameStep(dom.timelineInput);
				setCurrentTime(state.animation.currentTime + delta, { source: 'keyboard-step' });
			}
			draw();
		}
	});

	window.addEventListener('paste', (event) => {
		const items = event.clipboardData?.items;
		if (!items || items.length === 0) return;

		let imageFile = null;
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			if (item.kind === 'file' && item.type.startsWith('image/')) {
				imageFile = item.getAsFile();
				break;
			}
		}

		if (!imageFile) return;
		event.preventDefault();

		const nextUrl = URL.createObjectURL(imageFile);
		if (pastedMapObjectUrl) {
			URL.revokeObjectURL(pastedMapObjectUrl);
		}
		pastedMapObjectUrl = nextUrl;

		setPlaying(false);
		mapImage.src = nextUrl;
		setSaveStatus('Карта вставлена из буфера обмена (Ctrl+V)');
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
		const handleHit = state.mapMode === 'drag' && e.button === 0 && !e.shiftKey ? findSelectedKeyHandleAtScreen(pos.x, pos.y) : null;
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
			state.pointer.currentX = pos.x;
			state.pointer.currentY = pos.y;
			state.pointer.startCamX = state.camera.x;
			state.pointer.startCamY = state.camera.y;
			state.pointer.moved = false;
			return;
		}

		if (e.button !== 0) return;

		setPlaying(false);
		const startWorld = screenToWorld(pos.x, pos.y);

		state.pointer.mode = null;
		state.pointer.faction = hit ? hit.faction : null;
		state.pointer.index = hit ? hit.index : -1;
		state.pointer.keyIndex = -1;
		state.pointer.startX = pos.x;
		state.pointer.startY = pos.y;
		state.pointer.currentX = pos.x;
		state.pointer.currentY = pos.y;
		state.pointer.startCamX = state.camera.x;
		state.pointer.startCamY = state.camera.y;
		state.pointer.startWorldX = startWorld.x;
		state.pointer.startWorldY = startWorld.y;
		state.pointer.groupStartFrames = [];
		state.pointer.moved = false;

		if (state.mapMode === 'spawn') {
			state.pointer.mode = 'spawn';
			if (hit) {
				selectUnit(hit.faction, hit.index);
				drawUnitsLayer();
			}
			return;
		}

		if (state.mapMode === 'select') {
			if (hit) {
				state.pointer.mode = 'select-hit';
				return;
			}
			state.pointer.mode = 'selection-box';
			draw();
			return;
		}

		if (handleHit && state.selectedUnit.faction !== null && state.selectedUnit.index >= 0) {
			state.pointer.mode = 'keyframe-handle';
			state.pointer.faction = state.selectedUnit.faction;
			state.pointer.index = state.selectedUnit.index;
			state.pointer.keyIndex = handleHit.keyIndex;
			drawUnitsLayer();
			return;
		}

		state.pointer.mode = hit ? 'unit' : 'idle';

		if (hit) {
			const alreadySelected = isUnitSelected(hit.faction, hit.index);
			if (!alreadySelected) {
				setSelectedUnits([{ faction: hit.faction, index: hit.index }], hit);
			}

			const selectedUnits = getSelectedUnits();
			if (alreadySelected && selectedUnits.length > 1) {
				state.pointer.mode = 'unit-group';
				let createdAny = false;
				for (let i = 0; i < selectedUnits.length; i += 1) {
					const entry = selectedUnits[i];
					const inserted = upsertCurrentKeyframe(entry.unit);
					state.pointer.groupStartFrames.push({
						faction: entry.faction,
						unitId: entry.unit.id,
						keyIndex: inserted.index,
						startX: inserted.frame.x,
						startY: inserted.frame.y
					});
					if (inserted.created) createdAny = true;
				}
				if (createdAny) {
					state.hooks.renderBottomTimeline();
				}
			}

			if (handleHit && state.selectedUnit.faction !== null && state.selectedUnit.index >= 0) {
				state.pointer.mode = 'keyframe-handle';
				state.pointer.faction = state.selectedUnit.faction;
				state.pointer.index = state.selectedUnit.index;
				state.pointer.keyIndex = handleHit.keyIndex;
				drawUnitsLayer();
				return;
			}

			if (state.pointer.mode === 'unit') {
				state.pointer.faction = hit.faction;
				state.pointer.index = hit.index;
			}
			drawUnitsLayer();
			return;
		}
	});

	window.addEventListener('mousemove', (e) => {
		if (state.timelineScrub.active) {
			const source = state.timelineScrub.track === dom.timelineStrengthTrack ? 'timeline-strength-track' : 'timeline-track';
			seekTimelineByClientX(e.clientX, state.timelineScrub.track || dom.timelineTrack, source);
			draw();
			return;
		}

		if (!state.pointer.mode) return;

		const pos = getMousePos(e);
		state.pointer.currentX = pos.x;
		state.pointer.currentY = pos.y;
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

		if (state.pointer.mode === 'selection-box') {
			draw();
			return;
		}

		if (state.pointer.mode === 'unit-group') {
			const world = screenToWorld(pos.x, pos.y);
			const dx = world.x - state.pointer.startWorldX;
			const dy = world.y - state.pointer.startWorldY;
			for (let i = 0; i < state.pointer.groupStartFrames.length; i += 1) {
				const entry = state.pointer.groupStartFrames[i];
				const list = getUnitList(entry.faction);
				const idx = list.findIndex((unit) => unit.id === entry.unitId);
				if (idx < 0) continue;
				const unit = list[idx];
				const frame = unit.keyframes[entry.keyIndex];
				if (!frame) continue;
				frame.x = entry.startX + dx;
				frame.y = entry.startY + dy;
				unit.x = frame.x;
				unit.y = frame.y;
			}
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

		if (state.pointer.mode === 'spawn' && e.button === 0 && isClick && !e.shiftKey && state.pointer.index < 0) {
			addUnitAtScreen(pos.x, pos.y);
		}

		if (state.pointer.mode === 'selection-box' && e.button === 0) {
			if (isClick) {
				clearSelection();
			} else {
				const hits = getUnitsInsideRect(state.pointer.startX, state.pointer.startY, pos.x, pos.y);
				if (hits.length > 0) {
					setSelectedUnits(hits, hits[0]);
				} else {
					clearSelection();
				}
			}
		}

		if (state.pointer.mode === 'select-hit' && e.button === 0) {
			if (state.pointer.faction !== null && state.pointer.index >= 0) {
				setSelectedUnits([{ faction: state.pointer.faction, index: state.pointer.index }], {
					faction: state.pointer.faction,
					index: state.pointer.index
				});
			}
		}

		state.pointer.mode = null;
		state.pointer.faction = null;
		state.pointer.index = -1;
		state.pointer.keyIndex = -1;
		state.pointer.groupStartFrames = [];
		state.pointer.moved = false;
		syncUnitControls();
		draw();
	});

	dom.clearBtn.addEventListener('click', () => {
		setPlaying(false);
		state.units1 = [];
		state.units2 = [];
		clearSelection();
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
		const selectedUnits = getSelectedUnits();
		if (selectedUnits.length === 0) return;
		const value = parseFloat(dom.unitRadiusInput.value);
		let createdAny = false;
		for (let i = 0; i < selectedUnits.length; i += 1) {
			const unit = selectedUnits[i].unit;
			const inserted = upsertCurrentKeyframe(unit);
			inserted.frame.radius = value;
			unit.radius = value;
			if (inserted.created) createdAny = true;
		}
		if (selectedUnits.length === 1 && state.selectedUnit.faction !== null) {
			state.factionDefaultRadius[state.selectedUnit.faction] = value;
		}
		dom.unitRadiusValue.textContent = `${Math.round(value)} px`;
		if (createdAny) state.hooks.renderBottomTimeline();
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
		const selectedUnits = getSelectedUnits();
		if (selectedUnits.length === 0) return;

		const value = sanitizeStrength(parseFloat(dom.unitStrengthInput.value));
		let createdAny = false;
		for (let i = 0; i < selectedUnits.length; i += 1) {
			const unit = selectedUnits[i].unit;
			const inserted = upsertCurrentStrengthKeyframe(unit);
			inserted.frame.strength = value;
			unit.strength = value;
			if (inserted.created) createdAny = true;
		}
		if (selectedUnits.length === 1 && state.selectedUnit.faction !== null) {
			state.factionDefaultStrength[state.selectedUnit.faction] = value;
		}
		dom.unitStrengthInput.value = String(value);
		dom.unitStrengthValue.textContent = `${value}`;
		if (createdAny) {
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
			const selectedUnits = getSelectedUnits();
			if (selectedUnits.length > 0) {
				for (let i = 0; i < selectedUnits.length; i += 1) {
					selectedUnits[i].unit.type = selectedType;
				}
			}

			markInteracted();
			draw();
		});
	});

	dom.unitPathSplineInput.addEventListener('change', () => {
		const selectedUnits = getSelectedUnits();
		if (selectedUnits.length === 0) return;
		const enabled = dom.unitPathSplineInput.checked === true;
		for (let i = 0; i < selectedUnits.length; i += 1) {
			selectedUnits[i].unit.pathSmoothing = enabled;
		}
		dom.unitPathSplineInput.indeterminate = false;
		markInteracted();
		draw();
	});

	dom.smoothInput.addEventListener('input', draw);

	dom.frontWidthInput.addEventListener('input', () => {
		dom.frontWidthValue.textContent = Number(dom.frontWidthInput.value).toFixed(2);
		draw();
	});

	dom.areaOpacityInput.addEventListener('input', () => {
		dom.areaOpacityValue.textContent = `${Math.round(Number(dom.areaOpacityInput.value))}%`;
		draw();
	});

	dom.frontLineColorInput.addEventListener('input', () => {
		draw();
	});

	const fxInputs = [
		dom.turbulentEnabledInput,
		dom.turbulentAmountInput,
		dom.turbulentSizeInput,
		dom.turbulentComplexityInput,
		dom.turbulentEvolutionInput
	];

	fxInputs.forEach((input) => {
		const evt = input.type === 'checkbox' ? 'change' : 'input';
		input.addEventListener(evt, () => {
			pullFrontlineFxFromDom(dom, state.fx);
			markInteracted();
			draw();
		});
	});

	dom.timelineInput.addEventListener('input', () => {
		setPlaying(false);
		setCurrentTime(parseFloat(dom.timelineInput.value), { source: 'timeline-slider' });
		draw();
	});

	dom.timelineTrack.addEventListener('mousedown', (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		setPlaying(false);
		state.timelineScrub.active = true;
		state.timelineScrub.track = dom.timelineTrack;
		seekTimelineByClientX(event.clientX, dom.timelineTrack, 'timeline-track');
		draw();
	});

	dom.timelineStrengthTrack.addEventListener('mousedown', (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		setPlaying(false);
		state.timelineScrub.active = true;
		state.timelineScrub.track = dom.timelineStrengthTrack;
		seekTimelineByClientX(event.clientX, dom.timelineStrengthTrack, 'timeline-strength-track');
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
		updateTimelineSnapUi();
		updateSimDateTime();
	});

	dom.timelineSnapEnabledInput.addEventListener('change', () => {
		setTimelineSnapConfig({
			enabled: dom.timelineSnapEnabledInput.checked
		});
		setCurrentTime(state.animation.currentTime, { source: 'timeline-snap-toggle', autoKey: false });
		draw();
	});

	dom.timelineSnapStepValueInput.addEventListener('input', () => {
		setTimelineSnapConfig({
			stepValue: parseInt(dom.timelineSnapStepValueInput.value, 10)
		});
		setCurrentTime(state.animation.currentTime, { source: 'timeline-snap-step', autoKey: false });
		draw();
	});

	dom.timelineSnapUnitInput.addEventListener('change', () => {
		setTimelineSnapConfig({
			stepUnit: dom.timelineSnapUnitInput.value
		});
		setCurrentTime(state.animation.currentTime, { source: 'timeline-snap-unit', autoKey: false });
		draw();
	});

	dom.timelineAutoKeyEnabledInput.addEventListener('change', () => {
		setTimelineSnapConfig({
			autoKeyEnabled: dom.timelineAutoKeyEnabledInput.checked
		});
		draw();
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
