import {
	KEY_HANDLE_RADIUS
} from '../core/constants.js';
import { dom, gfx, mapImage, state } from '../core/state.js';
import { clamp, sanitizeStrength } from '../core/utils.js';
import {
	buildUnitShapePath,
	fitCameraToMap,
	getInfluenceRadius,
	getKeyframeSnap,
	getLockedKeyIndex,
	getSelectedUnitRef,
	getSelectedUnits,
	getUnitPoseAtTime,
	getUnitStrengthAtTime,
	isUnitSelected,
	worldToScreen
} from '../engine/simulation.js';
import {
	FRONTLINE_FX_GLSL,
	applyFrontlineFxUniforms,
	assignFrontlineFxUniformLocations
} from '../effects/frontlineEffects.js';

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
uniform float u_areaOpacity;
uniform vec3 u_frontLineColor;
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

${FRONTLINE_FX_GLSL}

void main() {
vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
vec2 world = (screen - u_resolution * 0.5) / u_zoom + u_camera;
vec2 sampledWorld = applyTurbulence(world);

float inf1 = 0.0;
float inf2 = 0.0;
float near1 = 0.0;
float near2 = 0.0;

for (int i = 0; i < u_count1; i++) {
vec4 unitData = readUnit(u_units1Tex, i);
float local = getInfluence(sampledWorld, unitData);
inf1 += local;
near1 = max(near1, local);
}

for (int i = 0; i < u_count2; i++) {
vec4 unitData = readUnit(u_units2Tex, i);
float local = getInfluence(sampledWorld, unitData);
inf2 += local;
near2 = max(near2, local);
}

vec3 col1 = vec3(0.15, 0.4, 0.8);
vec3 col2 = vec3(0.8, 0.2, 0.2);
vec3 zoneColor = vec3(0.0);
float zoneAlpha = 0.0;
float frontAlpha = 0.0;

float dominant = max(inf1, inf2);
if (dominant > 0.001) {
if (inf1 > inf2) {
zoneColor = col1;
} else {
zoneColor = col2;
}

float density = 1.0 - exp(-dominant * 1.35);
float nearDensity = max(near1, near2);
float baseAlpha = max(density, nearDensity * 0.85);
zoneAlpha = clamp(baseAlpha * 0.95 + 0.08, 0.0, 0.98) * clamp(u_areaOpacity, 0.0, 1.0);

float ratio = min(inf1, inf2) / max(dominant, 0.0001);
float contact = min(inf1, inf2);
float contactStrength = 1.0 - exp(-contact * 1.4);
float dynamicBand = clamp(u_frontThickness * (0.6 + contactStrength * 2.6), 0.01, 0.9);
float edge = smoothstep(1.0 - dynamicBand, 1.0, ratio);
frontAlpha = clamp(edge * (0.82 + contactStrength * 0.35), 0.0, 1.0);
}

float finalAlpha = zoneAlpha + frontAlpha * (1.0 - zoneAlpha);
vec3 finalColor = zoneColor;
if (frontAlpha > 0.0001) {
finalColor = mix(zoneColor, u_frontLineColor, frontAlpha);
}

outColor = vec4(finalColor, finalAlpha);
}`;

function parseHexColorToRgb(colorHex) {
	if (typeof colorHex !== 'string') return [1, 1, 1];
	const match = /^#([0-9a-fA-F]{6})$/.exec(colorHex.trim());
	if (!match) return [1, 1, 1];
	const intColor = Number.parseInt(match[1], 16);
	const r = ((intColor >> 16) & 255) / 255;
	const g = ((intColor >> 8) & 255) / 255;
	const b = (intColor & 255) / 255;
	return [r, g, b];
}

function getUnitDeathVisual(unit, currentTime) {
	const currentStrength = getUnitStrengthAtTime(unit, currentTime);
	if (currentStrength > 0) {
		return { dead: false, alpha: 1, gray: false };
	}

	if (!state.animation.playing) {
		return { dead: true, alpha: 1, gray: true };
	}

	const keys = unit.strengthKeyframes || [];
	let deathTime = null;
	if (keys.length === 0) {
		deathTime = 0;
	} else {
		const sorted = [...keys].sort((a, b) => a.t - b.t);
		if (sanitizeStrength(sorted[0].strength) <= 0 && currentTime >= sorted[0].t) {
			deathTime = sorted[0].t;
		}

		for (let i = 0; i < sorted.length - 1; i += 1) {
			const a = sorted[i];
			const b = sorted[i + 1];
			if (currentTime < a.t) break;
			const aStrength = sanitizeStrength(a.strength);
			const bStrength = sanitizeStrength(b.strength);
			if (aStrength > 0 && bStrength <= 0) {
				const span = Math.max(0.00001, b.t - a.t);
				const k = aStrength / Math.max(aStrength - bStrength, 0.00001);
				const crossTime = a.t + span * clamp(k, 0, 1);
				if (crossTime <= currentTime) {
					deathTime = crossTime;
				}
			}
		}

		if (deathTime === null && currentTime >= sorted[sorted.length - 1].t && sanitizeStrength(sorted[sorted.length - 1].strength) <= 0) {
			deathTime = sorted[sorted.length - 1].t;
		}
	}

	if (deathTime === null) deathTime = currentTime;
	const fadeDuration = 1.2;
	const alpha = clamp(1 - (currentTime - deathTime) / fadeDuration, 0, 1);
	return { dead: true, alpha, gray: false };
}

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

function createUnitsTexture() {
	const texture = gfx.gl.createTexture();
	gfx.gl.bindTexture(gfx.gl.TEXTURE_2D, texture);
	gfx.gl.texParameteri(gfx.gl.TEXTURE_2D, gfx.gl.TEXTURE_MIN_FILTER, gfx.gl.NEAREST);
	gfx.gl.texParameteri(gfx.gl.TEXTURE_2D, gfx.gl.TEXTURE_MAG_FILTER, gfx.gl.NEAREST);
	gfx.gl.texParameteri(gfx.gl.TEXTURE_2D, gfx.gl.TEXTURE_WRAP_S, gfx.gl.CLAMP_TO_EDGE);
	gfx.gl.texParameteri(gfx.gl.TEXTURE_2D, gfx.gl.TEXTURE_WRAP_T, gfx.gl.CLAMP_TO_EDGE);
	return texture;
}

function uploadUnits(texture, units) {
	const count = units.length;
	const width = Math.max(1, count);
	const buffer = new Float32Array(width * 4);

	for (let i = 0; i < count; i += 1) {
		const pose = getUnitPoseAtTime(units[i], state.animation.currentTime);
		const influenceRadius = getInfluenceRadius(units[i], pose);
		const k = i * 4;
		buffer[k] = pose.x;
		buffer[k + 1] = pose.y;
		buffer[k + 2] = influenceRadius;
		buffer[k + 3] = 1.0;
	}

	gfx.gl.bindTexture(gfx.gl.TEXTURE_2D, texture);
	gfx.gl.texImage2D(gfx.gl.TEXTURE_2D, 0, gfx.gl.RGBA32F, width, 1, 0, gfx.gl.RGBA, gfx.gl.FLOAT, buffer);
	return count;
}

export function drawMapLayer() {
	gfx.mapCtx.setTransform(1, 0, 0, 1, 0, 0);
	gfx.mapCtx.clearRect(0, 0, dom.mapCanvas.width, dom.mapCanvas.height);

	if (!state.mapReady) return;

	gfx.mapCtx.save();
	gfx.mapCtx.setTransform(
		state.camera.zoom,
		0,
		0,
		state.camera.zoom,
		dom.mapCanvas.width * 0.5 - state.camera.x * state.camera.zoom,
		dom.mapCanvas.height * 0.5 - state.camera.y * state.camera.zoom
	);
	gfx.mapCtx.drawImage(mapImage, 0, 0, state.mapWidth, state.mapHeight);
	gfx.mapCtx.restore();
}

export function drawUnitsLayer() {
	gfx.overlayCtx.clearRect(0, 0, dom.overlay.width, dom.overlay.height);

	const selectedUnits = getSelectedUnits();
	const primarySelected = getSelectedUnitRef();
	for (let u = 0; u < selectedUnits.length; u += 1) {
		const selected = selectedUnits[u].unit;
		if (!selected || selected.keyframes.length === 0) continue;

		gfx.overlayCtx.save();
		gfx.overlayCtx.strokeStyle = primarySelected === selected
			? 'rgba(255, 245, 163, 0.95)'
			: 'rgba(170, 203, 255, 0.7)';
		gfx.overlayCtx.lineWidth = primarySelected === selected ? 2 : 1.5;
		gfx.overlayCtx.beginPath();

		if (selected.pathSmoothing === true && selected.keyframes.length >= 3) {
			const first = worldToScreen(selected.keyframes[0].x, selected.keyframes[0].y);
			gfx.overlayCtx.moveTo(first.x, first.y);
			for (let i = 0; i < selected.keyframes.length - 1; i += 1) {
				const a = selected.keyframes[i];
				const b = selected.keyframes[i + 1];
				const span = Math.max(0.00001, b.t - a.t);
				const steps = 12;
				for (let s = 1; s <= steps; s += 1) {
					const sampleTime = a.t + span * (s / steps);
					const samplePose = getUnitPoseAtTime(selected, sampleTime);
					const pos = worldToScreen(samplePose.x, samplePose.y);
					gfx.overlayCtx.lineTo(pos.x, pos.y);
				}
			}
		} else {
			for (let i = 0; i < selected.keyframes.length; i += 1) {
				const key = selected.keyframes[i];
				const pos = worldToScreen(key.x, key.y);
				if (i === 0) {
					gfx.overlayCtx.moveTo(pos.x, pos.y);
				} else {
					gfx.overlayCtx.lineTo(pos.x, pos.y);
				}
			}
		}
		gfx.overlayCtx.stroke();
		gfx.overlayCtx.restore();
	}

	if (primarySelected && primarySelected.keyframes.length > 0) {
		const lockedIndex = getLockedKeyIndex(primarySelected);
		gfx.overlayCtx.save();
		for (let i = 0; i < primarySelected.keyframes.length; i += 1) {
			const key = primarySelected.keyframes[i];
			const pos = worldToScreen(key.x, key.y);
			const isCurrent = Math.abs(key.t - state.animation.currentTime) <= getKeyframeSnap();
			const isLocked = i === lockedIndex;

			gfx.overlayCtx.beginPath();
			gfx.overlayCtx.arc(pos.x, pos.y, KEY_HANDLE_RADIUS, 0, Math.PI * 2);
			gfx.overlayCtx.fillStyle = isLocked ? '#9aa0a6' : (isCurrent ? '#ffe66b' : '#f5f5f5');
			gfx.overlayCtx.fill();
			gfx.overlayCtx.lineWidth = 2;
			gfx.overlayCtx.strokeStyle = isLocked ? '#474c52' : (isCurrent ? '#7f5a00' : '#252525');
			gfx.overlayCtx.stroke();
		}
		gfx.overlayCtx.restore();
	}

	if (state.pointer.mode === 'selection-box') {
		const x = Math.min(state.pointer.startX, state.pointer.currentX);
		const y = Math.min(state.pointer.startY, state.pointer.currentY);
		const w = Math.abs(state.pointer.currentX - state.pointer.startX);
		const h = Math.abs(state.pointer.currentY - state.pointer.startY);
		gfx.overlayCtx.save();
		gfx.overlayCtx.fillStyle = 'rgba(159, 207, 255, 0.12)';
		gfx.overlayCtx.strokeStyle = 'rgba(159, 207, 255, 0.9)';
		gfx.overlayCtx.setLineDash([6, 4]);
		gfx.overlayCtx.lineWidth = 1.5;
		gfx.overlayCtx.fillRect(x, y, w, h);
		gfx.overlayCtx.strokeRect(x, y, w, h);
		gfx.overlayCtx.restore();
	}

	paint(state.units1, 1, '#2f78ff', '#d8e6ff');
	paint(state.units2, 2, '#d43a3a', '#ffd6d6');
}

function paint(units, faction, fillColor, strokeColor) {
	units.forEach((unit, index) => {
		const pose = getUnitPoseAtTime(unit, state.animation.currentTime);
		const animatedStrength = getUnitStrengthAtTime(unit, state.animation.currentTime);
		const deathVisual = getUnitDeathVisual(unit, state.animation.currentTime);
		if (deathVisual.alpha <= 0.001) return;
		const pos = worldToScreen(pose.x, pose.y);
		if (pos.x < -36 || pos.y < -36 || pos.x > dom.overlay.width + 36 || pos.y > dom.overlay.height + 36) return;

		const isSelected = isUnitSelected(faction, index);
		gfx.overlayCtx.save();
		gfx.overlayCtx.globalAlpha = deathVisual.alpha;
		buildUnitShapePath(gfx.overlayCtx, unit.type || 'circle', pos.x, pos.y, state.unitIconSize);
		gfx.overlayCtx.fillStyle = deathVisual.gray ? '#7d7f84' : fillColor;
		gfx.overlayCtx.fill();
		gfx.overlayCtx.lineWidth = isSelected ? 3 : 2;
		gfx.overlayCtx.strokeStyle = deathVisual.gray
			? (isSelected ? '#d4d6db' : '#4f5259')
			: (isSelected ? '#fff5a3' : strokeColor);
		gfx.overlayCtx.stroke();

		const strength = sanitizeStrength(animatedStrength);
		const fontSize = clamp(Math.round(state.unitIconSize * 0.85), 9, 14);
		gfx.overlayCtx.font = `700 ${fontSize}px Segoe UI, Tahoma, Geneva, Verdana, sans-serif`;
		gfx.overlayCtx.textAlign = 'center';
		gfx.overlayCtx.textBaseline = 'middle';
		gfx.overlayCtx.lineWidth = 3;
		gfx.overlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
		gfx.overlayCtx.strokeText(String(strength), pos.x, pos.y + 0.5);
		gfx.overlayCtx.fillStyle = deathVisual.gray ? '#e0e0e0' : '#f8f8f8';
		gfx.overlayCtx.fillText(String(strength), pos.x, pos.y + 0.5);
		gfx.overlayCtx.restore();
	});
}

export function drawInfluenceLayer() {
	gfx.gl.useProgram(gfx.program);
	gfx.gl.uniform2f(gfx.uLocs.res, dom.canvas.width, dom.canvas.height);
	gfx.gl.uniform1f(gfx.uLocs.smooth, parseFloat(dom.smoothInput.value));
	gfx.gl.uniform1f(gfx.uLocs.frontThickness, parseFloat(dom.frontWidthInput.value));
	gfx.gl.uniform1f(gfx.uLocs.areaOpacity, clamp(parseFloat(dom.areaOpacityInput.value) / 100, 0, 1));
	const frontLineRgb = parseHexColorToRgb(dom.frontLineColorInput.value);
	gfx.gl.uniform3f(gfx.uLocs.frontLineColor, frontLineRgb[0], frontLineRgb[1], frontLineRgb[2]);
	gfx.gl.uniform2f(gfx.uLocs.camera, state.camera.x, state.camera.y);
	gfx.gl.uniform1f(gfx.uLocs.zoom, state.camera.zoom);
	applyFrontlineFxUniforms(gfx.gl, gfx.uLocs, state.fx);

	const count1 = uploadUnits(gfx.unitsTex1, state.units1);
	const count2 = uploadUnits(gfx.unitsTex2, state.units2);

	gfx.gl.activeTexture(gfx.gl.TEXTURE0);
	gfx.gl.bindTexture(gfx.gl.TEXTURE_2D, gfx.unitsTex1);
	gfx.gl.uniform1i(gfx.uLocs.tex1, 0);

	gfx.gl.activeTexture(gfx.gl.TEXTURE1);
	gfx.gl.bindTexture(gfx.gl.TEXTURE_2D, gfx.unitsTex2);
	gfx.gl.uniform1i(gfx.uLocs.tex2, 1);

	gfx.gl.uniform1i(gfx.uLocs.c1, count1);
	gfx.gl.uniform1i(gfx.uLocs.c2, count2);

	gfx.gl.clear(gfx.gl.COLOR_BUFFER_BIT);
	gfx.gl.drawArrays(gfx.gl.TRIANGLES, 0, 6);
}

export function draw() {
	drawMapLayer();
	drawInfluenceLayer();
	drawUnitsLayer();
}

export function resize() {
	dom.mapCanvas.width = window.innerWidth;
	dom.mapCanvas.height = window.innerHeight;
	dom.canvas.width = window.innerWidth;
	dom.canvas.height = window.innerHeight;
	dom.overlay.width = window.innerWidth;
	dom.overlay.height = window.innerHeight;
	gfx.gl.viewport(0, 0, dom.canvas.width, dom.canvas.height);

	if (!state.hasUserInteracted && state.mapReady) {
		fitCameraToMap();
	}

	draw();
}

function initWebglResources() {
	gfx.program = createProgram(gfx.gl, vsSource, fsSource);
	gfx.gl.useProgram(gfx.program);
	gfx.gl.enable(gfx.gl.BLEND);
	gfx.gl.blendFunc(gfx.gl.SRC_ALPHA, gfx.gl.ONE_MINUS_SRC_ALPHA);
	gfx.gl.clearColor(0.0, 0.0, 0.0, 0.0);

	const positionBuffer = gfx.gl.createBuffer();
	gfx.gl.bindBuffer(gfx.gl.ARRAY_BUFFER, positionBuffer);
	gfx.gl.bufferData(
		gfx.gl.ARRAY_BUFFER,
		new Float32Array([
			-1.0, -1.0,
			1.0, -1.0,
			-1.0, 1.0,
			-1.0, 1.0,
			1.0, -1.0,
			1.0, 1.0
		]),
		gfx.gl.STATIC_DRAW
	);

	const posLoc = gfx.gl.getAttribLocation(gfx.program, 'a_position');
	gfx.gl.enableVertexAttribArray(posLoc);
	gfx.gl.vertexAttribPointer(posLoc, 2, gfx.gl.FLOAT, false, 0, 0);

	gfx.uLocs = {
		res: gfx.gl.getUniformLocation(gfx.program, 'u_resolution'),
		smooth: gfx.gl.getUniformLocation(gfx.program, 'u_smoothness'),
		frontThickness: gfx.gl.getUniformLocation(gfx.program, 'u_frontThickness'),
		areaOpacity: gfx.gl.getUniformLocation(gfx.program, 'u_areaOpacity'),
		frontLineColor: gfx.gl.getUniformLocation(gfx.program, 'u_frontLineColor'),
		camera: gfx.gl.getUniformLocation(gfx.program, 'u_camera'),
		zoom: gfx.gl.getUniformLocation(gfx.program, 'u_zoom'),
		c1: gfx.gl.getUniformLocation(gfx.program, 'u_count1'),
		c2: gfx.gl.getUniformLocation(gfx.program, 'u_count2'),
		tex1: gfx.gl.getUniformLocation(gfx.program, 'u_units1Tex'),
		tex2: gfx.gl.getUniformLocation(gfx.program, 'u_units2Tex')
	};

	Object.assign(gfx.uLocs, assignFrontlineFxUniformLocations(gfx.gl, gfx.program));

	gfx.unitsTex1 = createUnitsTexture();
	gfx.unitsTex2 = createUnitsTexture();
}

export function initRenderer() {
	initWebglResources();
	state.hooks.draw = draw;
}
