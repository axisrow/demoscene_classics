import { mandelbrotZoom } from './mandelbrot-core.js';
import { buildGradientPalette, packHexColor } from './utils.js';

const VERTEX_SHADER = `#version 300 es
const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uSpan;
uniform float uEscapeSquared;
uniform float uZoom;
uniform int uMaxIterations;
uniform int uUsePerturbation;
uniform sampler2D uReferenceOrbit;
uniform int uReferenceWidth;
uniform sampler2D uPalette;
uniform int uPaletteWidth;
uniform int uPaletteSize;
uniform vec4 uInteriorColor;

out vec4 fragmentColor;

vec2 complexSquare(vec2 value) {
  return vec2(
    value.x * value.x - value.y * value.y,
    2.0 * value.x * value.y
  );
}

vec2 complexMultiply(vec2 left, vec2 right) {
  return vec2(
    left.x * right.x - left.y * right.y,
    left.x * right.y + left.y * right.x
  );
}

vec4 referenceValue(int index) {
  return texelFetch(
    uReferenceOrbit,
    ivec2(index % uReferenceWidth, index / uReferenceWidth),
    0
  );
}

vec4 paletteValue(int index) {
  return texelFetch(
    uPalette,
    ivec2(index % uPaletteWidth, index / uPaletteWidth),
    0
  );
}

bool isMainInterior(vec2 point) {
  float shifted = point.x - 0.25;
  float q = shifted * shifted + point.y * point.y;
  return q * (q + shifted) <= 0.25 * point.y * point.y
    || (point.x + 1.0) * (point.x + 1.0) + point.y * point.y <= 0.0625;
}

void main() {
  float pixelX = gl_FragCoord.x - 0.5;
  float pixelY = uResolution.y - gl_FragCoord.y - 0.5;
  float aspect = uResolution.x / uResolution.y;
  vec2 deltaC = vec2(
    -uSpan + 2.0 * uSpan * pixelX / uResolution.x,
    -uSpan / aspect + 2.0 * uSpan * pixelY / (aspect * uResolution.y)
  );
  vec2 point = uCenter + deltaC;

  if (uZoom < 100.0 && isMainInterior(point)) {
    fragmentColor = uInteriorColor;
    return;
  }

  vec2 z = vec2(0.0);
  vec2 deltaZ = vec2(0.0);
  int iteration = 0;
  bool escaped = false;

  for (int index = 0; index < uMaxIterations; index++) {
    if (uUsePerturbation == 1) {
      vec4 packedReference = referenceValue(index);
      vec4 packedNext = referenceValue(index + 1);
      vec2 referenceHigh = packedReference.rg;
      vec2 referenceLow = packedReference.ba;
      deltaZ = complexSquare(deltaZ)
        + 2.0 * complexMultiply(referenceHigh, deltaZ)
        + 2.0 * complexMultiply(referenceLow, deltaZ)
        + deltaC;
      z = packedNext.rg + (packedNext.ba + deltaZ);
    } else {
      z = complexSquare(z) + point;
    }

    iteration = index + 1;
    if (dot(z, z) >= uEscapeSquared) {
      escaped = true;
      break;
    }
  }

  if (!escaped) {
    fragmentColor = uInteriorColor;
    return;
  }

  const float LOG_TWO = 0.6931471805599453;
  float logZn = log(dot(z, z)) * 0.5;
  float nu = log(logZn / LOG_TWO) / LOG_TWO;
  float smoothValue = float(iteration) + 1.0 - nu;
  int paletteIndex = int(abs(floor(smoothValue * 8.0))) % uPaletteSize;
  fragmentColor = paletteValue(paletteIndex);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create Mandelbrot WebGL2 shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error.';
    gl.deleteShader(shader);
    throw new Error(`Mandelbrot WebGL2 shader failed: ${message}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create Mandelbrot WebGL2 program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown program link error.';
    gl.deleteProgram(program);
    throw new Error(`Mandelbrot WebGL2 program failed: ${message}`);
  }
  return program;
}

function isWebGL2Context(context) {
  return Boolean(context
    && typeof context.createShader === 'function'
    && typeof context.drawArrays === 'function'
    && typeof context.texImage2D === 'function');
}

export function probeMandelbrotWebGL2() {
  const canvas = globalThis.document?.createElement?.('canvas');
  const gl = canvas?.getContext?.('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: false
  });
  if (!isWebGL2Context(gl)) return false;
  try {
    const program = createProgram(gl);
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return false;
  }
}

function textureShape(gl, length) {
  const maximumWidth = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const width = Math.min(maximumWidth, length);
  return { width, height: Math.ceil(length / width) };
}

function createTexture(gl, unit) {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Unable to create Mandelbrot WebGL2 texture.');
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function fillReferenceOrbit(target, maximumIterations, centerX, centerY) {
  let real = 0;
  let imaginary = 0;
  let valid = true;

  function store(index) {
    const offset = index * 4;
    const highReal = Math.fround(real);
    const highImaginary = Math.fround(imaginary);
    target[offset] = highReal;
    target[offset + 1] = highImaginary;
    target[offset + 2] = real - highReal;
    target[offset + 3] = imaginary - highImaginary;
  }

  store(0);
  for (let index = 0; index < maximumIterations; index++) {
    const nextImaginary = 2 * real * imaginary + centerY;
    const nextReal = real * real - imaginary * imaginary + centerX;
    real = nextReal;
    imaginary = nextImaginary;
    if (!Number.isFinite(real) || !Number.isFinite(imaginary)) valid = false;
    store(index + 1);
  }
  return valid;
}

function uploadPalette(gl, texture, palette, shape) {
  const bytes = new Uint8Array(shape.width * shape.height * 4);
  for (let index = 0; index < palette.length; index++) {
    const packed = palette[index] >>> 0;
    const offset = index * 4;
    bytes[offset] = packed & 0xff;
    bytes[offset + 1] = packed >>> 8 & 0xff;
    bytes[offset + 2] = packed >>> 16 & 0xff;
    bytes[offset + 3] = 0xff;
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8,
    shape.width, shape.height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, bytes
  );
}

function colorChannels(packed) {
  const color = packed >>> 0;
  return [
    (color & 0xff) / 255,
    (color >>> 8 & 0xff) / 255,
    (color >>> 16 & 0xff) / 255,
    1
  ];
}

export function createMandelbrotWebGLRenderer({ canvas, config }) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    // renderOnce() must remain visible after the compositor has consumed the
    // frame (notably for reduced-motion and static proof captures).
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  if (!isWebGL2Context(gl)) throw new Error('WebGL2 is not available.');

  let program = null;
  let referenceTexture = null;
  let paletteTexture = null;
  let referenceShape = null;
  let referencePixels = null;
  let referenceOrbitValid = false;
  let width = 2;
  let height = 2;
  let contextLost = false;
  let wakeScheduler = null;
  const previousImageRendering = canvas.style?.imageRendering;
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const paletteShape = textureShape(gl, palette.length);
  const interiorColor = colorChannels(packHexColor(config.appearance.interiorColor));
  const maximumIterations = config.algorithm.maxIterations ?? Math.floor(
    config.algorithm.iterationBase
      + config.algorithm.iterationGrowth * Math.log10(config.camera.maxZoom + 1)
  );

  function uniforms() {
    const names = [
      'uResolution', 'uCenter', 'uSpan', 'uEscapeSquared', 'uZoom',
      'uMaxIterations', 'uUsePerturbation', 'uReferenceOrbit',
      'uReferenceWidth', 'uPalette', 'uPaletteWidth', 'uPaletteSize',
      'uInteriorColor'
    ];
    return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
  }

  let locations = null;

  function initialize() {
    program = createProgram(gl);
    locations = uniforms();
    referenceTexture = createTexture(gl, 0);
    paletteTexture = createTexture(gl, 1);
    referenceShape = textureShape(gl, maximumIterations + 1);
    referencePixels = new Float32Array(referenceShape.width * referenceShape.height * 4);
    referenceOrbitValid = fillReferenceOrbit(
      referencePixels,
      maximumIterations,
      config.camera.centerX,
      config.camera.centerY
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, referenceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F,
      referenceShape.width, referenceShape.height, 0,
      gl.RGBA, gl.FLOAT, referencePixels
    );
    uploadPalette(gl, paletteTexture, palette, paletteShape);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  function disposeResources() {
    if (referenceTexture) gl.deleteTexture(referenceTexture);
    if (paletteTexture) gl.deleteTexture(paletteTexture);
    if (program) gl.deleteProgram(program);
    referenceTexture = null;
    paletteTexture = null;
    program = null;
    locations = null;
  }

  function onContextLost(event) {
    event.preventDefault?.();
    contextLost = true;
  }

  function onContextRestored() {
    contextLost = false;
    disposeResources();
    initialize();
    wakeScheduler?.();
  }

  canvas.addEventListener?.('webglcontextlost', onContextLost);
  canvas.addEventListener?.('webglcontextrestored', onContextRestored);
  initialize();
  if (canvas.style) canvas.style.imageRendering = config.render.smoothing ? 'auto' : 'pixelated';

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(2, Math.floor(nextWidth * config.render.resolution));
      height = Math.max(2, Math.floor(nextHeight * config.render.resolution));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
    },
    render({ time }) {
      if (contextLost || !program) return;
      const zoom = mandelbrotZoom(time * config.motion.speed, {
        ...config.camera,
        ...config.motion
      });
      const calculatedIterations = Math.floor(
        config.algorithm.iterationBase
          + config.algorithm.iterationGrowth * Math.log10(zoom + 1)
      );
      const frameIterations = config.algorithm.maxIterations ?? calculatedIterations;
      // The reference orbit depends only on the configured camera centre and
      // iteration ceiling, not on zoom. It is uploaded once when the backend
      // is initialised instead of being recomputed and transferred every frame.
      const usePerturbation = zoom >= 1000 && referenceOrbitValid;
      gl.useProgram(program);
      gl.viewport(0, 0, width, height);
      gl.uniform2f(locations.uResolution, width, height);
      gl.uniform2f(locations.uCenter, config.camera.centerX, config.camera.centerY);
      gl.uniform1f(locations.uSpan, 3 / zoom);
      gl.uniform1f(locations.uEscapeSquared, config.algorithm.escapeRadius ** 2);
      gl.uniform1f(locations.uZoom, zoom);
      gl.uniform1i(locations.uMaxIterations, frameIterations);
      gl.uniform1i(locations.uUsePerturbation, usePerturbation ? 1 : 0);
      gl.uniform1i(locations.uReferenceOrbit, 0);
      gl.uniform1i(locations.uReferenceWidth, referenceShape.width);
      gl.uniform1i(locations.uPalette, 1);
      gl.uniform1i(locations.uPaletteWidth, paletteShape.width);
      gl.uniform1i(locations.uPaletteSize, palette.length);
      gl.uniform4f(locations.uInteriorColor, ...interiorColor);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    getStats() {
      return { backend: 'webgl2' };
    },
    isAvailable() {
      return !contextLost;
    },
    setWake(callback) {
      wakeScheduler = callback;
    },
    destroy() {
      canvas.removeEventListener?.('webglcontextlost', onContextLost);
      canvas.removeEventListener?.('webglcontextrestored', onContextRestored);
      if (canvas.style) canvas.style.imageRendering = previousImageRendering;
      wakeScheduler = null;
      disposeResources();
    }
  };
}
