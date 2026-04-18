import { dom, state } from '../core/state.js';
import { clamp, formatSeconds } from '../core/utils.js';
import {
	getSelectedUnitRef,
	getKeyframeSnap,
	setCurrentTime,
	setPlaying
} from '../engine/simulation.js';

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

function appendTimelineMarker(container, time, titlePrefix, markerClass = '') {
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
	});

	marker.addEventListener('click', (event) => {
		event.stopPropagation();
		setPlaying(false);
		setCurrentTime(time);
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
		appendTimelineMarker(dom.timelineMarkers, sorted[i].t, 'Кадр позиции');
	}

	const sortedStrength = [...strengthKeys].sort((a, b) => a.t - b.t);
	for (let i = 0; i < sortedStrength.length; i += 1) {
		appendTimelineMarker(dom.timelineStrengthMarkers, sortedStrength[i].t, 'Кадр прочности', 'strength-marker');
	}

	updateTimelinePlayhead();
	updateTimelineCurrentLabel();
}

export function seekTimelineByClientX(clientX, trackElement = dom.timelineTrack) {
	const rect = trackElement.getBoundingClientRect();
	const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
	setCurrentTime(state.animation.duration * ratio);
}

export function initTimelineHooks() {
	state.hooks.renderBottomTimeline = renderBottomTimeline;
	state.hooks.updateTimelineCurrentLabel = updateTimelineCurrentLabel;
	state.hooks.updateTimelinePlayhead = updateTimelinePlayhead;
	state.hooks.updateTimelineMarkersSelection = updateTimelineMarkersSelection;
}
