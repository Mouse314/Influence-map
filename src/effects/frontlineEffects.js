import { clamp } from '../core/utils.js';

export const FRONTLINE_FX_DEFAULTS = Object.freeze({
	turbulentEnabled: false,
	turbulentAmount: 14,
	turbulentSize: 280,
	turbulentComplexity: 3,
	turbulentEvolution: 0.0
});

export function createFrontlineFxState() {
	return {
		...FRONTLINE_FX_DEFAULTS
	};
}

function toFiniteNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

export function normalizeFrontlineFx(rawEffects = {}, fallback = FRONTLINE_FX_DEFAULTS) {
	const next = {
		turbulentEnabled: rawEffects.turbulentEnabled !== undefined ? rawEffects.turbulentEnabled === true : !!fallback.turbulentEnabled,
		turbulentAmount: clamp(toFiniteNumber(rawEffects.turbulentAmount, fallback.turbulentAmount), 0, 40),
		turbulentSize: clamp(toFiniteNumber(rawEffects.turbulentSize, fallback.turbulentSize), 40, 800),
		turbulentComplexity: Math.round(clamp(toFiniteNumber(rawEffects.turbulentComplexity, fallback.turbulentComplexity), 1, 6)),
		turbulentEvolution: clamp(toFiniteNumber(rawEffects.turbulentEvolution, fallback.turbulentEvolution), 0, 3)
	};

	return next;
}

export function serializeFrontlineFx(fxState) {
	const fx = normalizeFrontlineFx(fxState, FRONTLINE_FX_DEFAULTS);
	return {
		turbulentEnabled: fx.turbulentEnabled,
		turbulentAmount: fx.turbulentAmount,
		turbulentSize: fx.turbulentSize,
		turbulentComplexity: fx.turbulentComplexity,
		turbulentEvolution: fx.turbulentEvolution
	};
}

export function syncFrontlineFxDom(dom, fxState) {
	dom.turbulentEnabledInput.checked = !!fxState.turbulentEnabled;
	dom.turbulentAmountInput.value = String(fxState.turbulentAmount);
	dom.turbulentSizeInput.value = String(fxState.turbulentSize);
	dom.turbulentComplexityInput.value = String(fxState.turbulentComplexity);
	dom.turbulentEvolutionInput.value = String(fxState.turbulentEvolution);

	dom.turbulentAmountValue.textContent = fxState.turbulentAmount.toFixed(1);
	dom.turbulentSizeValue.textContent = `${Math.round(fxState.turbulentSize)}`;
	dom.turbulentComplexityValue.textContent = `${Math.round(fxState.turbulentComplexity)}`;
	dom.turbulentEvolutionValue.textContent = fxState.turbulentEvolution.toFixed(2);
}

export function pullFrontlineFxFromDom(dom, fxState) {
	const normalized = normalizeFrontlineFx({
		turbulentEnabled: dom.turbulentEnabledInput.checked,
		turbulentAmount: dom.turbulentAmountInput.value,
		turbulentSize: dom.turbulentSizeInput.value,
		turbulentComplexity: dom.turbulentComplexityInput.value,
		turbulentEvolution: dom.turbulentEvolutionInput.value
	}, fxState);

	Object.assign(fxState, normalized);
	syncFrontlineFxDom(dom, fxState);
}

export const FRONTLINE_FX_GLSL = `
uniform float u_turbulentEnabled;
uniform float u_turbulentAmount;
uniform float u_turbulentSize;
uniform int u_turbulentComplexity;
uniform float u_turbulentEvolution;

float hash31(vec3 p) {
    p = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p.yzx + 19.19);
    return fract(p.x * p.y * p.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    
    float a = hash31(i + vec3(0.0, 0.0, 0.0));
    float b = hash31(i + vec3(1.0, 0.0, 0.0));
    float c = hash31(i + vec3(0.0, 1.0, 0.0));
    float d = hash31(i + vec3(1.0, 1.0, 0.0));
    float e = hash31(i + vec3(0.0, 0.0, 1.0));
    float g = hash31(i + vec3(1.0, 0.0, 1.0)); 
    float h = hash31(i + vec3(0.0, 1.0, 1.0));
    float k = hash31(i + vec3(1.0, 1.0, 1.0));
    
    return mix(
        mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
        mix(mix(e, g, u.x), mix(h, k, u.x), u.y),
        u.z
    );
}

float fbm3(vec3 p) {
	float value = 0.0;
	float amplitude = 0.5;
	vec3 shift = vec3(19.2, 7.4, 0.0);

	for (int i = 0; i < 6; i++) {
		if (i >= u_turbulentComplexity) {
			break;
		}
		value += amplitude * noise3(p);
		p = p * 2.0 + shift;
		amplitude *= 0.5;
	}

	return value;
}

vec2 applyTurbulence(vec2 world) {
	if (u_turbulentEnabled < 0.5 || u_turbulentAmount <= 0.001) {
		return world;
	}

	float scale = max(1.0, u_turbulentSize);
	float evo = u_turbulentEvolution * 3.0;
	vec3 p = vec3(world / scale, evo);

	float nx = fbm3(p + vec3(13.4, 7.9, 0.11));
	float ny = fbm3(p + vec3(-5.1, 22.7, -0.09));
	vec2 offset = (vec2(nx, ny) * 2.0 - 1.0) * u_turbulentAmount;

	return world + offset;
}
`;

export function assignFrontlineFxUniformLocations(glContext, program) {
	return {
		turbulentEnabled: glContext.getUniformLocation(program, 'u_turbulentEnabled'),
		turbulentAmount: glContext.getUniformLocation(program, 'u_turbulentAmount'),
		turbulentSize: glContext.getUniformLocation(program, 'u_turbulentSize'),
		turbulentComplexity: glContext.getUniformLocation(program, 'u_turbulentComplexity'),
		turbulentEvolution: glContext.getUniformLocation(program, 'u_turbulentEvolution')
	};
}

export function applyFrontlineFxUniforms(glContext, uniformLocations, fxState) {
	const fx = normalizeFrontlineFx(fxState, FRONTLINE_FX_DEFAULTS);

	glContext.uniform1f(uniformLocations.turbulentEnabled, fx.turbulentEnabled ? 1 : 0);
	glContext.uniform1f(uniformLocations.turbulentAmount, fx.turbulentAmount);
	glContext.uniform1f(uniformLocations.turbulentSize, fx.turbulentSize);
	glContext.uniform1i(uniformLocations.turbulentComplexity, fx.turbulentComplexity);
	glContext.uniform1f(uniformLocations.turbulentEvolution, fx.turbulentEvolution);
}
