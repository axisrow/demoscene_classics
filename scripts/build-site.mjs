import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, '_site');
const pages = [
  'index.html',
  '01-plasma.html',
  '02-fire.html',
  '03-starfield.html',
  '04-metaballs.html',
  '05-tunnel.html',
  '06-mandelbrot.html',
  '07-sine-scroller.html',
  '08-rotozoom.html',
  '09-feedback.html',
  '10-copper-bars.html',
  'index.css',
  'demo.css',
  '.nojekyll'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all(pages.map((filename) =>
  copyFile(join(root, filename), join(outputDirectory, filename))
));
await cp(join(root, 'dist'), join(outputDirectory, 'dist'), { recursive: true });

console.log('Assembled GitHub Pages artifact in _site/.');
