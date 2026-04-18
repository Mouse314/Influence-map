import { dom, state } from '../core/state.js';
import { clamp, formatSeconds } from '../core/utils.js';
import {
	getSelectedUnitRef,
	getKeyframeSnap,
	markInteracted,
	movePoseKeyframeToTime,
	moveStrengthKeyframeToTime,
	snapTimeForTimelineEdit,
	setCurrentTime,
	setPlaying
} from '../engine/simulation.js';

const markerDragState = {
	active: false,
	keyType: null,
	keyRef: null,
	trackElement: null
};

function timeToPercent(time) {
	return clamp(time / Math.max(state.animation.duration, 0.0001), 0, 1) * 100;
}

export function updateTimelineCurrentLabel() {
	dom.timelineCurrentLabel.textContent = `${formatSeconds(state.animation.currentTime)} / ${Math.round(state.animation.duration)} c`;
	dom.timelineTrack.setAttribute('aria-valuemax', String(state.animation.duration));
	dom.timelineTrack.setAttribute('aria-valuenow', String(state.animation.currentTime.toFixed(1)));
}

export function updateTimelinePlayhead() {
	const left = `${timeToPercent(state.animation.currentTime)}%`;
	dom.timelinePlayhead.style.left = left;
	dom.timelineStrengthPlayhead.style.left = left;
}

export function updateTimelineMarkersSelection() {
	const markers = dom.timelineDock.querySelectorAll('.timeline-marker');
	markers.forEach((marker) => {
		const t = parseFloat(marker.dataset.time);
		const isActive = Math.abs(t - state.animation.currentTime) <= getKeyframeSnap();
		marker.classList.toggle('active', isActive);
	});
}

function beginMarkerDrag(keyType, keyRef, trackElement, clientX) {
	if (!keyRef || !trackElement) return;
	markerDragState.active = true;
	markerDragState.keyType = keyType;
	markerDragState.keyRef = keyRef;
	markerDragState.trackElement = trackElement;
	window.addEventListener('mousemove', onMarkerDragMove);
	window.addEventListener('mouseup', endMarkerDrag);
	onMarkerDragMove({ clientX });
}

function onMarkerDragMove(event) {
	if (!markerDragState.active) return;
	const unit = getSelectedUnitRef();
	if (!unit || !markerDragState.trackElement || !markerDragState.keyRef) {
		endMarkerDrag();
		return;
	}

	const rect = markerDragState.trackElement.getBoundingClientRect();
	const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
	const rawTime = state.animation.duration * ratio;
	const targetTime = snapTimeForTimelineEdit(rawTime);

	const movedRef = markerDragState.keyType === 'strength'
		? moveStrengthKeyframeToTime(unit, markerDragState.keyRef, targetTime)
		: movePoseKeyframeToTime(unit, markerDragState.keyRef, targetTime);

	if (!movedRef) {
		endMarkerDrag();
		return;
	}

	markerDragState.keyRef = movedRef;
	setCurrentTime(targetTime, { source: 'timeline-marker-drag', autoKey: false });
	markInteracted();
	state.hooks.renderBottomTimeline();
	state.hooks.draw();
}

function endMarkerDrag() {
	if (!markerDragState.active) return;
	markerDragState.active = false;
	markerDragState.keyType = null;
	markerDragState.keyRef = null;
	markerDragState.trackElement = null;
	window.removeEventListener('mousemove', onMarkerDragMove);
	window.removeEventListener('mouseup', endMarkerDrag);
}

function appendTimelineMarkerWithRef(container, time, keyType, keyRef, titlePrefix, markerClass = '') {
	const marker = document.createElement('button');
	marker.type = 'button';
	marker.className = markerClass ? `timeline-marker ${markerClass}` : 'timeline-marker';
	marker.style.left = `${timeToPercent(time)}%`;
	marker.dataset.time = time.toFixed(4);
	marker.title = `${titlePrefix}: ${formatSeconds(time)}`;
	if (Math.abs(time - state.animation.currentTime) <= getKeyframeSnap()) {
		marker.classList.add('active');
	}

	marker.addEventListener('mousedown', (event) => {
		event.stopPropagation();
		event.preventDefault();
		setPlaying(false);
		if (keyType && keyRef) {
			beginMarkerDrag(keyType, keyRef, container === dom.timelineStrengthMarkers ? dom.timelineStrengthTrack : dom.timelineTrack, event.clientX);
			return;
		}

		setCurrentTime(time, { source: 'timeline-marker-click' });
		state.hooks.draw();
	});

	container.appendChild(marker);
}

export function renderBottomTimeline() {
	const unit = getSelectedUnitRef();
	dom.timelineMarkers.innerHTML = '';
	dom.timelineStrengthMarkers.innerHTML = '';

	if (!unit) {
		dom.timelineSelectedLabel.textContent = 'Выберите дивизию, чтобы увидеть ее ключи';
		updateTimelinePlayhead();
		updateTimelineCurrentLabel();
		return;
	}

	const strengthKeys = unit.strengthKeyframes || [];
	dom.timelineSelectedLabel.textContent = `Дивизия: позиция ${unit.keyframes.length}, прочность ${strengthKeys.length}`;

	const sorted = [...unit.keyframes].sort((a, b) => a.t - b.t);
	for (let i = 0; i < sorted.length; i += 1) {
		appendTimelineMarkerWithRef(dom.timelineMarkers, sorted[i].t, 'pose', sorted[i], 'Кадр позиции');
	}

	const sortedStrength = [...strengthKeys].sort((a, b) => a.t - b.t);
	for (let i = 0; i < sortedStrength.length; i += 1) {
		appendTimelineMarkerWithRef(dom.timelineStrengthMarkers, sortedStrength[i].t, 'strength', sortedStrength[i], 'Кадр прочности', 'strength-marker');
	}

	updateTimelinePlayhead();
	updateTimelineCurrentLabel();
}

export function seekTimelineByClientX(clientX, trackElement = dom.timelineTrack, source = 'timeline-track') {
	const rect = trackElement.getBoundingClientRect();
	const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
	setCurrentTime(state.animation.duration * ratio, { source });
}

export function initTimelineHooks() {
	state.hooks.renderBottomTimeline = renderBottomTimeline;
	state.hooks.updateTimelineCurrentLabel = updateTimelineCurrentLabel;
	state.hooks.updateTimelinePlayhead = updateTimelinePlayhead;
	state.hooks.updateTimelineMarkersSelection = updateTimelineMarkersSelection;
}
