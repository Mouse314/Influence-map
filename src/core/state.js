import {
	DEFAULT_ICON_SIZE,
	DEFAULT_UNIT_STRENGTH
} from './constants.js';

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

export const dom = {
	mapCanvas,
	canvas,
	overlay,
	unitRadiusInput: document.getElementById('unitRadius'),
	unitRadiusValue: document.getElementById('unitRadiusValue'),
	iconSizeInput: document.getElementById('iconSize'),
	iconSizeValue: document.getElementById('iconSizeValue'),
	unitStrengthInput: document.getElementById('unitStrength'),
	unitStrengthValue: document.getElementById('unitStrengthValue'),
	unitTypeInputs: Array.from(document.querySelectorAll('input[name="unitType"]')),
	smoothInput: document.getElementById('smooth'),
	frontWidthInput: document.getElementById('frontWidth'),
	frontWidthValue: document.getElementById('frontWidthValue'),
	timelineInput: document.getElementById('timeline'),
	timelineValue: document.getElementById('timelineValue'),
	durationInput: document.getElementById('duration'),
	durationValue: document.getElementById('durationValue'),
	playPauseBtn: document.getElementById('playPauseBtn'),
	addKeyBtn: document.getElementById('addKeyBtn'),
	deleteKeyBtn: document.getElementById('deleteKeyBtn'),
	keyframeMeta: document.getElementById('keyframeMeta'),
	timelineDock: document.getElementById('timelineDock'),
	timelineTrack: document.getElementById('timelineTrack'),
	timelineMarkers: document.getElementById('timelineMarkers'),
	timelinePlayhead: document.getElementById('timelinePlayhead'),
	timelineStrengthTrack: document.getElementById('timelineStrengthTrack'),
	timelineStrengthMarkers: document.getElementById('timelineStrengthMarkers'),
	timelineStrengthPlayhead: document.getElementById('timelineStrengthPlayhead'),
	timelineSelectedLabel: document.getElementById('timelineSelectedLabel'),
	timelineCurrentLabel: document.getElementById('timelineCurrentLabel'),
	simDateLabel: document.getElementById('simDate'),
	simTimeLabel: document.getElementById('simTime'),
	startDateInput: document.getElementById('startDate'),
	dayDurationInput: document.getElementById('dayDuration'),
	dayDurationValue: document.getElementById('dayDurationValue'),
	saveLocalBtn: document.getElementById('saveLocalBtn'),
	loadLocalBtn: document.getElementById('loadLocalBtn'),
	exportJsonBtn: document.getElementById('exportJsonBtn'),
	importJsonBtn: document.getElementById('importJsonBtn'),
	importJsonInput: document.getElementById('importJsonInput'),
	saveStatus: document.getElementById('saveStatus'),
	clearBtn: document.getElementById('clearBtn')
};

export const gfx = {
	mapCtx,
	overlayCtx,
	gl,
	program: null,
	uLocs: null,
	unitsTex1: null,
	unitsTex2: null
};

export const mapImage = new Image();
mapImage.src = 'Снимок экрана 2026-04-17 180436.png';

export const state = {
	mapReady: false,
	mapWidth: window.innerWidth,
	mapHeight: window.innerHeight,
	hasUserInteracted: false,
	camera: {
		x: window.innerWidth * 0.5,
		y: window.innerHeight * 0.5,
		zoom: 1,
		minZoom: 0.25,
		maxZoom: 5
	},
	animation: {
		currentTime: 0,
		duration: 120,
		playing: false,
		lastTimestamp: 0,
		speed: 1,
		loop: true
	},
	chrono: {
		startDateMsUtc: Date.UTC(1941, 0, 1),
		dayDuration: 12
	},
	nextUnitId: 1,
	factionDefaultRadius: { 1: 70, 2: 70 },
	factionDefaultStrength: { 1: DEFAULT_UNIT_STRENGTH, 2: DEFAULT_UNIT_STRENGTH },
	defaultUnitType: 'circle',
	unitIconSize: DEFAULT_ICON_SIZE,
	selectedUnit: { faction: null, index: -1 },
	pointer: {
		mode: null,
		faction: null,
		index: -1,
		keyIndex: -1,
		startX: 0,
		startY: 0,
		startCamX: 0,
		startCamY: 0,
		moved: false
	},
	timelineScrub: {
		active: false,
		track: null
	},
	animationRaf: null,
	autosaveTimer: null,
	units1: [],
	units2: [],
	hooks: {
		draw: () => {},
		renderBottomTimeline: () => {},
		updateTimelineCurrentLabel: () => {},
		updateTimelinePlayhead: () => {},
		updateTimelineMarkersSelection: () => {},
		onInteraction: () => {}
	}
};
