import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'dist');

const effects = [
  ['plasma', 'createPlasmaRenderer', 'normalizePlasmaConfig', 'plasma.js'],
  ['fire', 'createFireRenderer', 'normalizeFireConfig', 'fire.js'],
  ['starfield', 'createStarfieldRenderer', 'normalizeStarfieldConfig', 'starfield.js'],
  ['metaballs', 'createMetaballsRenderer', 'normalizeMetaballsConfig', 'metaballs.js'],
  ['tunnel', 'createTunnelRenderer', 'normalizeTunnelConfig', 'tunnel.js'],
  ['mandelbrot', 'createMandelbrotRenderer', 'normalizeMandelbrotConfig', 'mandelbrot.js'],
  ['sineScroller', 'createSineScrollerRenderer', 'normalizeSineScrollerConfig', 'sine-scroller.js'],
  ['rotozoom', 'createRotozoomRenderer', 'normalizeRotozoomConfig', 'rotozoom.js'],
  ['feedback', 'createFeedbackRenderer', 'normalizeFeedbackConfig', 'feedback.js'],
  ['copperBars', 'createCopperBarsRenderer', 'normalizeCopperBarsConfig', 'copper-bars.js']
];

function entrySource(selectedEffects) {
  const imports = selectedEffects.map(([name, exported, normalizer, filename], index) =>
    `import { ${exported} as effect${index}, ${normalizer} as normalize${index} } from './src/effects/${filename}';`
  );
  const installers = selectedEffects.map(([name], index) =>
    `installEffect('${name}', effect${index}, normalize${index});`
  );
  return [
    "import { installEffect } from './src/install.js';",
    ...imports,
    ...installers
  ].join('\n');
}

async function bundle(selectedEffects, outfile) {
  await build({
    stdin: {
      contents: entrySource(selectedEffects),
      loader: 'js',
      resolveDir: root,
      sourcefile: 'browser-entry.js'
    },
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    legalComments: 'none',
    charset: 'utf8',
    outfile,
    logLevel: 'silent'
  });
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(join(outputDirectory, 'effects'), { recursive: true });

await bundle(effects, join(outputDirectory, 'demoscene.js'));
for (const effect of effects) {
  const filename = effect[3];
  await bundle([effect], join(outputDirectory, 'effects', filename));
}

const version = process.env.GITHUB_SHA || process.env.DEMOSCENE_VERSION || 'local';
await writeFile(
  join(outputDirectory, 'manifest.json'),
  `${JSON.stringify({ version, apiVersion: 2, bundle: 'demoscene.js' }, null, 2)}\n`
);

console.log(`Built ${effects.length + 1} browser scripts and manifest in dist/.`);
