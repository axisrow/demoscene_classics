import { assertNumber, createEffectDefaults } from '../../config.js';

const POINT_KEYS = new Set([
  'amplitudeX', 'amplitudeY', 'frequencyX', 'frequencyY',
  'phaseX', 'phaseY', 'strength'
]);

export const METABALLS_DEFAULTS = createEffectDefaults({
  render: { resolution: 1 / 3, smoothing: false },
  motion: { speed: 1 },
  appearance: {
    palette: ['#050014', '#0a2878', '#00aac8', '#3ce678', '#f0e628', '#ffffff'],
    colorCount: 512,
    backgroundColor: '#050014'
  },
  field: {
    pointCount: 5,
    points: null,
    fieldStrength: 1,
    threshold: 1,
    lowScale: 60,
    highScale: 420
  }
});

/**
 * Pre-merge check on raw caller input: pointCount and points are mutually
 * exclusive (the renderer derives pointCount from points when both are given).
 * @param {string} name
 * @param {object} explicit
 */
export function validateMetaballsInput(name, explicit) {
  if (explicit?.field?.points !== undefined && explicit?.field?.pointCount !== undefined) {
    throw new RangeError(`${name}.field.pointCount and ${name}.field.points cannot be used together.`);
  }
}

/**
 * Validate the fully resolved metaballs configuration (scalar-field fields).
 * Note: pointCount/points mutual exclusion is checked at the descriptor level
 * (caller input), while here we normalise the resolved field shape.
 * @param {object} config
 */
export function validateMetaballs(config) {
  assertNumber(config.field.pointCount, 'metaballs.field.pointCount', { min: 1, max: 64, integer: true });
  for (const key of ['fieldStrength', 'threshold', 'lowScale', 'highScale']) {
    assertNumber(config.field[key], `metaballs.field.${key}`, { min: Number.MIN_VALUE });
  }
  if (config.field.points !== null) {
    if (!Array.isArray(config.field.points) || config.field.points.length < 1 || config.field.points.length > 64) {
      throw new RangeError('metaballs.field.points must contain between 1 and 64 points.');
    }
    config.field.points.forEach((point, index) => {
      if (point === null || typeof point !== 'object' || Array.isArray(point)) {
        throw new TypeError(`metaballs.field.points[${index}] must be an object.`);
      }
      for (const key of Object.keys(point)) {
        if (!POINT_KEYS.has(key)) throw new RangeError(`Unknown option: metaballs.field.points[${index}].${key}`);
      }
      for (const key of POINT_KEYS) {
        assertNumber(point[key], `metaballs.field.points[${index}].${key}`, {
          min: key === 'strength' ? Number.MIN_VALUE : -Infinity
        });
      }
    });
    config.field.pointCount = config.field.points.length;
  }
}
