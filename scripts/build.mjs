import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'dist');

const effects = [
  ['plasma', 'createPlasmaRenderer', 'plasma.js'],
  ['fire', 'createFireRenderer', 'fire.js'],
  ['starfield', 'createStarfieldRenderer', 'starfield.js'],
  ['metaballs', 'createMetaballsRenderer', 'metaballs.js'],
  ['tunnel', 'createTunnelRenderer', 'tunnel.js'],
  ['mandelbrot', 'createMandelbrotRenderer', 'mandelbrot.js'],
  ['sineScroller', 'createSineScrollerRenderer', 'sine-scroller.js'],
  ['rotozoom', 'createRotozoomRenderer', 'rotozoom.js'],
  ['feedback', 'createFeedbackRenderer', 'feedback.js'],
  ['copperBars', 'createCopperBarsRenderer', 'copper-bars.js']
];

function entrySource(selectedEffects) {
  const imports = selectedEffects.map(([name, exported, filename], index) =>
    `import { ${exported} as effect${index} } from './src/effects/${filename}';`
  );
  const installers = selectedEffects.map(([name], index) =>
    `installEffect('${name}', effect${index});`
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
  const filename = effect[2];
  await bundle([effect], join(outputDirectory, 'effects', filename));
}

console.log(`Built ${effects.length + 1} browser scripts in dist/.`);
