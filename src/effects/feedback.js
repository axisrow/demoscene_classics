import { getContext2D } from './utils.js';

export function createFeedbackRenderer({ canvas }) {
  const context = getContext2D(canvas);
  let width = 1;
  let height = 1;
  let pointerX = null;
  let pointerY = null;
  let hasRendered = false;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      hasRendered = false;
    },
    pointer(x, y) {
      pointerX = x;
      pointerY = y;
    },
    render({ time, delta }) {
      if (hasRendered && delta === 0) return;
      const frameFactor = delta * 60;
      if (hasRendered) {
        context.globalCompositeOperation = 'lighter';
        context.globalAlpha = 0.93 ** frameFactor;
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(0.012 * frameFactor);
        context.scale(0.985 ** frameFactor, 0.985 ** frameFactor);
        context.translate(-width / 2, -height / 2);
        context.drawImage(canvas, 0, 0);
        context.restore();

        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 1;
        context.fillStyle = `rgba(0,0,5,${1 - 0.96 ** frameFactor})`;
        context.fillRect(0, 0, width, height);
      }

      const centerX = pointerX === null
        ? width / 2 + Math.cos(time * 0.6) * width * 0.18
        : pointerX;
      const centerY = pointerY === null
        ? height / 2 + Math.sin(time * 0.7) * height * 0.18
        : pointerY;

      context.globalCompositeOperation = 'lighter';
      const hue = time * 60 % 360;
      const sides = 5;
      const radius = 40 + Math.sin(time * 3) * 14;
      for (let pass = 0; pass < 3; pass++) {
        context.beginPath();
        const passRadius = radius + pass * 8;
        for (let point = 0; point <= sides; point++) {
          const angle = point / sides * Math.PI * 2 + time * (1 + pass * 0.3);
          const x = centerX + Math.cos(angle) * passRadius;
          const y = centerY + Math.sin(angle) * passRadius;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.lineWidth = 2;
        context.strokeStyle = `hsla(${(hue + pass * 60) % 360},100%,65%,0.9)`;
        context.shadowColor = context.strokeStyle;
        context.shadowBlur = 18;
        context.stroke();
      }
      context.shadowBlur = 0;
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      hasRendered = true;
    }
  };
}
