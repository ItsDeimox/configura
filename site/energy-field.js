/* Ini Studio: pixel-sharp pointer shader, no fullscreen animation. */
const VERTEX = "#version 300 es\nprecision highp float;\nvoid main() {\n  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);\n}";
const FRAGMENT = "#version 300 es\nprecision highp float;\n\nuniform vec2 u_resolution;\nuniform float u_dpr;\nuniform float u_time;\nuniform float u_strength;\nout vec4 fragColor;\n\nfloat segmentDistance(vec2 p, vec2 a, vec2 b) {\n  vec2 d = b - a;\n  return length(p - a - d * clamp(dot(p - a, d) / dot(d, d), 0.0, 1.0));\n}\nvoid main() {\n  // All distances are expressed in physical CSS pixels. DPR only improves antialiasing.\n  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_dpr;\n  float dist = length(p);\n  if (dist > 205.0) {\n    fragColor = vec4(0.0);\n    return;\n  }\n  float focus = pow(max(0.0, 1.0 - dist / 210.0), 2.0);\n  float t = u_time;\n\n  // Screen-space grid with subpixel hairlines, not large blurred outlines.\n  vec2 cell = abs(fract((p + vec2(33.0, 12.0)) / 86.0) - 0.5) * 86.0;\n  float gridDistance = min(cell.x, cell.y);\n  float hairline = 1.0 - smoothstep(0.22, 1.15, gridDistance);\n  float joint = 1.0 - smoothstep(0.1, 2.0, length(cell));\n  float phase = p.x * 0.036 + p.y * 0.019 - t * 4.8;\n  float head = pow(max(0.0, sin(phase)), 22.0);\n  float tail = pow(max(0.0, sin(phase - 0.65)), 5.0);\n  float grid = (hairline * (0.16 + head * 0.32 + tail * 0.07) + joint * 0.28) * focus;\n\n  // Sparse energy rails, sharp core and restrained halo near a vertex.\n  float wireDist = min(\n    segmentDistance(p, vec2(-187.0,-58.0), vec2(-61.0,-58.0)),\n    min(\n      segmentDistance(p, vec2(-61.0,-58.0), vec2(-22.0,-19.0)),\n      segmentDistance(p, vec2(70.0,62.0), vec2(189.0,62.0))\n    )\n  );\n  float wire = (1.0 - smoothstep(0.25, 1.15, wireDist))\n             * (0.18 + 0.42 * head + 0.13 * tail) * focus;\n  float nodeDistance = min(length(p - vec2(-61.0,-58.0)),length(p - vec2(70.0,62.0)));\n  float node = (1.0 - smoothstep(0.3, 2.4, nodeDistance)) * 0.56 * focus;\n  float microGlow = exp(-nodeDistance * 0.105) * 0.065 * focus;\n\n  float energy = (grid + wire + node + microGlow) * u_strength;\n  // Soft SDR highlight rolloff: no fake blur or neon bloom pass.\n  vec3 tint = mix(vec3(0.48,0.62,0.84),vec3(0.82,0.87,0.96),clamp(head + node,0.0,1.0));\n  float luminance = 1.0 - exp(-energy * 2.6);\n  float alpha = clamp(luminance * 0.60, 0.0, 0.54);\n  fragColor = vec4(tint * luminance * alpha, alpha); // premultiplied alpha\n}";

/*
 * Pointer-local Aurora Field v2.
 * Single small WebGL2 canvas. Never a fullscreen continually-rendered shader.
 * Renders only during pointer activity; pauses immediately on scrolling / background tabs.
 * Includes CSS fallback for blocked WebGL, low-power devices and context loss.
 */
const canvas = document.getElementById('energy-canvas');
const effectsLayer = document.querySelector('.visual-backdrop');
const coarsePointer = matchMedia('(hover: none), (pointer: coarse)').matches;
const state = {
  gl: null,
  program: null,
  uniforms: null,
  enabled: !document.documentElement.classList.contains('effects-off'),
  ready: false,
  running: 0,
  lastDraw: 0,
  lastMotion: -1,
  scrollTimeout: 0,
  suspended: false,
  dpr: 1,
  centerX: -1000,
  centerY: -1000,
  targetX: -1000,
  targetY: -1000,
  width: 0,
  height: 0,
  slowFrames: 0,
  quality: 1,
  contextFailed: false
};
const CSS_SIZE = 420;
const ACTIVITY_MS = 420;
const MIN_FRAME_MS = 1000 / 24;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('GLSL shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'GLSL compilation failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}
function updateResolution() {
  if (!state.ready) return;
  const nativeRatio = Math.max(1, devicePixelRatio || 1);
  // 0.6 MP max for the interactive layer, higher pixel density for thin strokes.
  state.dpr = Math.min(nativeRatio, 1.85 * state.quality, Math.sqrt(620000) / CSS_SIZE);
  const side = Math.max(1, Math.round(CSS_SIZE * state.dpr));
  if (canvas.width !== side || canvas.height !== side) {
    canvas.width = side;
    canvas.height = side;
  }
  state.width = side;
  state.height = side;
  state.gl.viewport(0, 0, side, side);
}
function init() {
  if (!canvas || coarsePointer || !state.enabled || state.contextFailed) return false;
  if (state.ready) return true;
  try {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      state.contextFailed = true;
      document.documentElement.dataset.shader = 'css-fallback';
      return false;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!program) throw new Error('GLSL program allocation failed');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'GLSL program link failed');
    }
    gl.bindVertexArray(gl.createVertexArray());
    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    state.gl = gl;
    state.program = program;
    state.uniforms = {
      res: gl.getUniformLocation(program, 'u_resolution'),
      dpr: gl.getUniformLocation(program, 'u_dpr'),
      time: gl.getUniformLocation(program, 'u_time'),
      strength: gl.getUniformLocation(program, 'u_strength')
    };
    state.ready = true;
    document.documentElement.dataset.shader = 'webgl2';
    updateResolution();
    return true;
  } catch (error) {
    console.warn('[Ini Studio] Aurora shader disabled:', error.message);
    state.contextFailed = true;
    state.ready = false;
    document.documentElement.dataset.shader = 'css-fallback';
    return false;
  }
}
function stop() {
  if (state.running) cancelAnimationFrame(state.running);
  state.running = 0;
  canvas.style.opacity = '0';
}
function animate(now) {
  state.running = 0;
  if (!state.enabled || state.suspended || document.hidden || !state.ready) return;

  const activeFor = now - state.lastMotion;
  if (activeFor > ACTIVITY_MS) {
    canvas.style.opacity = '0';
    return;
  }

  const positionEase = 0.35;
  state.centerX += (state.targetX - state.centerX) * positionEase;
  state.centerY += (state.targetY - state.centerY) * positionEase;
  canvas.style.transform =
    'translate3d(' + (state.centerX - CSS_SIZE / 2).toFixed(1) + 'px,' +
    (state.centerY - CSS_SIZE / 2).toFixed(1) + 'px,0)';
  canvas.style.opacity = '0.86';

  const delta = now - state.lastDraw;
  if (!state.lastDraw || delta >= MIN_FRAME_MS) {
    state.lastDraw = now;
    const gl = state.gl;
    const uniforms = state.uniforms;
    const strength = Math.max(0.01, Math.min(1, (ACTIVITY_MS - activeFor) / 230));
    gl.useProgram(state.program);
    gl.uniform2f(uniforms.res, state.width, state.height);
    gl.uniform1f(uniforms.dpr, state.dpr);
    gl.uniform1f(uniforms.time, now * .001);
    gl.uniform1f(uniforms.strength, strength);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Lower backing resolution if this effect is consistently slow.
    if (delta > 85 && delta < 900) state.slowFrames++;
    else state.slowFrames = Math.max(0, state.slowFrames - 1);
    if (state.slowFrames >= 5 && state.quality > .65) {
      state.quality = .7;
      state.slowFrames = 0;
      updateResolution();
    }
  }
  state.running = requestAnimationFrame(animate);
}
function requestTick() {
  if (!state.enabled || state.suspended || document.hidden || state.running) return;
  if (!init()) return;
  state.running = requestAnimationFrame(animate);
}
function suspendDuringScroll() {
  if (!state.enabled) return;
  state.suspended = true;
  effectsLayer?.classList.add('is-scrolling');
  stop();
  clearTimeout(state.scrollTimeout);
  state.scrollTimeout = setTimeout(() => {
    state.suspended = false;
    effectsLayer?.classList.remove('is-scrolling');
    // Do not restart a continuously running draw loop after scrolling.
  }, 180);
}
window.addEventListener('pointermove', event => {
  if (!state.enabled || state.suspended || coarsePointer || event.pointerType === 'touch') return;
  state.targetX = event.clientX;
  state.targetY = event.clientY;
  if (state.centerX < -500) {
    state.centerX = state.targetX;
    state.centerY = state.targetY;
  }
  state.lastMotion = performance.now();
  requestTick();
}, { passive: true });
window.addEventListener('scroll', suspendDuringScroll, { passive: true });
window.addEventListener('wheel', suspendDuringScroll, { passive: true });
window.addEventListener('resize', () => {
  stop();
  if (state.ready) updateResolution();
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});
window.addEventListener('ini-studio:effects', event => {
  state.enabled = Boolean(event.detail?.enabled);
  if (!state.enabled) stop();
  else if (state.contextFailed) document.documentElement.dataset.shader = 'css-fallback';
});
canvas?.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  stop();
  state.ready = false;
  state.contextFailed = true;
  document.documentElement.dataset.shader = 'css-fallback';
});
canvas?.addEventListener('webglcontextrestored', () => {
  state.contextFailed = false;
  state.ready = false;
  // Lazy recompilation on next real pointer interaction.
});
if (coarsePointer) document.documentElement.dataset.shader = 'mobile-css';
