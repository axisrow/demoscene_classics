import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'dist');

// One row per effect: [publicName, definitionModule, definitionExport, outputFilename].
// The build consumes effect definitions from each per-effect package; legacy
// renderer-factory/normalizer pairs no longer exist in API v3. Output filenames
// are intentionally unchanged so standalone bundles keep their public URLs.
const effects = [
  ['plasma', 'plasma/index.js', 'plasmaDefinition', 'plasma.js'],
  ['fire', 'fire/index.js', 'fireDefinition', 'fire.js'],
  ['starfield', 'starfield/index.js', 'starfieldDefinition', 'starfield.js'],
  ['metaballs', 'metaballs/index.js', 'metaballsDefinition', 'metaballs.js'],
  ['tunnel', 'tunnel/index.js', 'tunnelDefinition', 'tunnel.js'],
  ['mandelbrot', 'mandelbrot/index.js', 'mandelbrotDefinition', 'mandelbrot.js'],
  ['sineScroller', 'sine-scroller/index.js', 'sineScrollerDefinition', 'sine-scroller.js'],
  ['rotozoom', 'rotozoom/index.js', 'rotozoomDefinition', 'rotozoom.js'],
  ['feedback', 'feedback/index.js', 'feedbackDefinition', 'feedback.js'],
  ['copperBars', 'copper-bars/index.js', 'copperBarsDefinition', 'copper-bars.js']
];

function entrySource(selectedEffects) {
  const imports = selectedEffects.map(([name, module, exported], index) =>
    `import { ${exported} as definition${index} } from './src/effects/${module}';`
  );
  const installers = selectedEffects.map(([name], index) =>
    `installEffect(definition${index});`
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

// Skin names are plain object keys on an exported registry; importing the
// definition modules in the build process touches no browser-only code (every
// renderer factory and WebGL probe is a function, never executed at import).
async function readEffectMetadata() {
  const items = [];
  for (const [name, module, exported] of effects) {
    const url = pathToFileURL(join(root, 'src', 'effects', module)).href;
    const mod = await import(url);
    const definition = mod[exported];
    items.push({
      name,
      skins: Object.keys(definition.skins),
      surfaces: Object.keys(definition.profiles.surfaces),
      devices: Object.keys(definition.profiles.devices)
    });
  }
  return items;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(join(outputDirectory, 'effects'), { recursive: true });

await bundle(effects, join(outputDirectory, 'demoscene.js'));
for (const effect of effects) {
  const filename = effect[3];
  await bundle([effect], join(outputDirectory, 'effects', filename));
}

const version = process.env.GITHUB_SHA || process.env.DEMOSCENE_VERSION || 'local';
const effectMetadata = await readEffectMetadata();
await writeFile(
  join(outputDirectory, 'manifest.json'),
  `${JSON.stringify({
    version,
    apiVersion: 3,
    bundle: 'demoscene.js',
    effects: effectMetadata.map((effect) => ({
      name: effect.name,
      skins: effect.skins,
      surfaces: effect.surfaces,
      devices: effect.devices
    }))
  }, null, 2)}\n`
);

console.log(`Built ${effects.length + 1} browser scripts and manifest in dist/.`);
