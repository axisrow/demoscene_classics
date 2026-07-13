# Demoscene Classics

Beginner-friendly Canvas 2D versions of ten classic demoscene effects. The
library is distributed as ordinary browser scripts, so the examples work both
from a web server and by opening the HTML files directly.

## Use one effect

Add a canvas, load the standalone script, and call the matching function:

```html
<canvas id="demo" style="width:100vw;height:100vh"></canvas>
<script src="dist/effects/plasma.js"></script>
<script>
  const plasma = Demoscene.plasma('#demo');
</script>
```

Available functions are `plasma`, `fire`, `starfield`, `metaballs`, `tunnel`,
`mandelbrot`, `sineScroller`, `rotozoom`, `feedback`, and `copperBars`.

## Use several effects

Load the complete bundle once, then mount any number of effects:

```html
<script src="dist/demoscene.js"></script>
<script>
  const plasma = Demoscene.plasma('#plasma');
  const fire = Demoscene.fire('#fire', { quality: 'preview' });
</script>
```

Every function accepts a canvas element or CSS selector. It starts immediately
and returns a controller:

```js
const effect = Demoscene.starfield('#demo', {
  quality: 'full',       // "full" or "preview"
  autoStart: true
});

effect.stop();
effect.start();
effect.resize();
effect.destroy();
```

`preview` uses the same renderer with a smaller rendering budget. Preview
instances pause automatically while they are outside the viewport.

## Development

```sh
npm install
npm run build
npm test
```

The source modules live in `src/`. `npm run build` creates the complete bundle
and ten standalone scripts in `dist/`; keep those generated files alongside the
HTML demos so direct `file://` opening continues to work.
