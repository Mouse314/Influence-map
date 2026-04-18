import { dom, mapImage, state } from './core/state.js';
import { clamp, parseDateInputToUtcMs } from './core/utils.js';
import {
	fitCameraToMap,
	getUnitTypeSelection,
	seedInitialUnits,
	setCurrentTime,
	setDuration,
	setTimelineSnapConfig,
	syncUnitControls,
	updateDayDurationLabel,
	updateTimelineSnapUi,
	updateSimDateTime
} from './engine/simulation.js';
import { initPersistence, loadStateFromLocalStorage, setSaveStatus } from './engine/persistence.js';
import { draw, initRenderer, resize } from './render/renderer.js';
import { initTimelineHooks, renderBottomTimeline } from './timeline/timeline.js';
import { registerControls } from './ui/controls.js';

initRenderer();
initTimelineHooks();
initPersistence();
registerControls();

seedInitialUnits();

setDuration(state.animation.duration);
setCurrentTime(state.animation.currentTime);
resize();

state.unitIconSize = clamp(parseFloat(dom.iconSizeInput.value), 6, 28);
dom.iconSizeValue.textContent = `${Math.round(state.unitIconSize)} px`;
state.defaultUnitType = getUnitTypeSelection();
syncUnitControls();
dom.frontWidthValue.textContent = Number(dom.frontWidthInput.value).toFixed(2);
dom.areaOpacityValue.textContent = `${Math.round(Number(dom.areaOpacityInput.value))}%`;
state.chrono.startDateMsUtc = parseDateInputToUtcMs(dom.startDateInput.value);
state.chrono.dayDuration = clamp(parseFloat(dom.dayDurationInput.value), 0.1, 600);
setTimelineSnapConfig({
	enabled: dom.timelineSnapEnabledInput.checked,
	stepValue: parseInt(dom.timelineSnapStepValueInput.value, 10),
	stepUnit: dom.timelineSnapUnitInput.value,
	autoKeyEnabled: dom.timelineAutoKeyEnabledInput.checked
});
updateDayDurationLabel();
updateTimelineSnapUi();
updateSimDateTime();
renderBottomTimeline();

function handleMapImageLoaded() {
	state.mapReady = true;
	state.mapWidth = mapImage.naturalWidth || state.mapWidth;
	state.mapHeight = mapImage.naturalHeight || state.mapHeight;

	if (!state.hasUserInteracted) {
		fitCameraToMap();
		setCurrentTime(0);
		seedInitialUnits();
	}

	draw();
}

mapImage.onload = handleMapImageLoaded;
if (mapImage.complete) {
	handleMapImageLoaded();
}

if (!loadStateFromLocalStorage(false)) {
	setSaveStatus('Состояние сохранения: нет данных');
}
