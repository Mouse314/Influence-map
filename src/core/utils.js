import { DEFAULT_UNIT_STRENGTH } from './constants.js';

export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

export function sanitizeStrength(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return DEFAULT_UNIT_STRENGTH;
	return Math.round(clamp(numeric, 0, 100));
}

export function strengthNorm(value) {
	return sanitizeStrength(value) / 100;
}

export function formatSeconds(value) {
	return `${value.toFixed(1)} c`;
}

export function parseDateInputToUtcMs(value) {
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

export function formatDateForInput(ms) {
	const d = new Date(ms);
	const year = d.getUTCFullYear();
	const month = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function formatDateFromUtcMs(ms) {
	const d = new Date(ms);
	const day = String(d.getUTCDate()).padStart(2, '0');
	const month = String(d.getUTCMonth() + 1).padStart(2, '0');
	const year = d.getUTCFullYear();
	return `${day}.${month}.${year}`;
}

export function formatClockFromMinutes(totalMinutes) {
	if (totalMinutes >= 1440) return '24:00';
	const hours = Math.floor(totalMinutes / 60);
	return `${String(hours).padStart(2, '0')}:00`;
}

export function getFrameStep(timelineInput) {
	const step = parseFloat(timelineInput.step);
	if (!Number.isFinite(step) || step <= 0) return 0.1;
	return step;
}

export function isInteractiveTarget(target) {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
}

export function normalizeUnitType(type) {
	return ['circle', 'rect', 'diamond'].includes(type) ? type : 'circle';
}
