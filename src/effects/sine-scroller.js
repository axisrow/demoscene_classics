import { getContext2D } from './utils.js';

const TEXT = '  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ';

export function createSineScrollerRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const starCount = quality === 'preview' ? 40 : 220;
  const stars = Array.from({ length: starCount }, () => ({}));
  let width = 1;
  let height = 1;

  function resetStars() {
    for (const star of stars) {
      star.x = Math.random() * width;
      star.y = Math.random() * height;
      star.z = Math.random() * 2 + 0.2;
      star.size = Math.random() * 1.6 + 0.3;
    }
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resetStars();
    },
    render({ time, delta }) {
      context.fillStyle = '#04040a';
      context.fillRect(0, 0, width, height);

      for (const star of stars) {
        star.x -= star.z * 36 * delta;
        if (star.x < 0) {
          star.x = width;
          star.y = Math.random() * height;
        }
        const alpha = 0.3 + star.z / 2.2 * 0.7;
        context.fillStyle = `rgba(120,160,255,${alpha})`;
        context.fillRect(star.x, star.y, star.size, star.size);
      }

      const fontSize = Math.min(72, height * 0.13);
      context.font = `900 ${fontSize}px 'Courier New', monospace`;
      context.textBaseline = 'middle';
      context.textAlign = 'left';

      const baseline = height * 0.62;
      const amplitude = height * 0.12;
      const frequency = 0.018;
      const characterWidth = fontSize * 0.62;
      const totalWidth = TEXT.length * characterWidth;
      const offset = time * 132 % totalWidth;
      const passes = Math.ceil((width + offset) / totalWidth) + 1;
      const phase = time * 3;

      for (let pass = 0; pass < passes; pass++) {
        const startX = -offset + pass * totalWidth;
        for (let index = 0; index < TEXT.length; index++) {
          const x = startX + index * characterWidth + characterWidth / 2;
          if (x < -characterWidth || x > width + characterWidth) continue;
          const y = baseline + Math.sin(x * frequency + phase) * amplitude;
          const hue = (index * 18 + time * 120) % 360;
          context.fillStyle = 'rgba(0,0,0,0.6)';
          context.fillText(TEXT[index], x - fontSize * 0.5 + 4, y + 4);
          context.fillStyle = `hsl(${hue},100%,${62 + Math.sin(x * frequency * 2 + phase) * 12}%)`;
          context.fillText(TEXT[index], x - fontSize * 0.5, y);
        }
      }
    }
  };
}
