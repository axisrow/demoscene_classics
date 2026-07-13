import { getContext2D } from './utils.js';

const FOV = 256;

export function createStarfieldRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const count = quality === 'preview' ? 30 : 600;
  const stars = Array.from({ length: count }, () => ({}));
  let width = 1;
  let height = 1;
  let centerX = 0.5;
  let centerY = 0.5;

  function spawn(star, far = false) {
    star.x = (Math.random() * 2 - 1) * width;
    star.y = (Math.random() * 2 - 1) * height;
    star.z = far ? 256 : Math.random() * 255 + 1;
    star.previousX = null;
    star.previousY = null;
  }

  function resetStars() {
    for (const star of stars) spawn(star);
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      centerX = width / 2;
      centerY = height / 2;
      resetStars();
    },
    render({ delta }) {
      context.fillStyle = 'rgba(0,0,0,0.35)';
      context.fillRect(0, 0, width, height);

      for (const star of stars) {
        star.z -= 192 * delta;
        if (star.z <= 1) {
          spawn(star, true);
          continue;
        }

        const x = star.x / star.z * FOV + centerX;
        const y = star.y / star.z * FOV + centerY;
        if (star.previousX !== null) {
          const depth = 1 - star.z / 256;
          const speed = depth * depth;
          context.strokeStyle = `rgba(${180 + speed * 75 | 0},${200 + speed * 55 | 0},255,${0.25 + speed * 0.7})`;
          context.lineWidth = 1 + speed * 2;
          context.beginPath();
          context.moveTo(star.previousX, star.previousY);
          context.lineTo(x, y);
          context.stroke();
        }
        star.previousX = x;
        star.previousY = y;
      }
    }
  };
}
