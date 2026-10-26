/* Intro: a bunch of shooting stars streak in and settle into the "A" mark in the middle of the screen. */

export interface ShootOpts {
  /** ms for the stars to arrive; the mark then fades in over `settleMs` */
  travelMs: number;
  settleMs: number;
  star: string; // CSS colour of the streaks
  onSettled?: () => void;
}

interface P { tx: number; ty: number; sx: number; sy: number; delay: number; span: number; size: number }

const easeOut = (u: number) => 1 - (1 - u) ** 3;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Samples target points from the mark's alpha channel. */
function sampleMark(img: HTMLImageElement, box: number, n: number): { x: number; y: number }[] {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 256, 256);
  const d = g.getImageData(0, 0, 256, 256).data;
  const pts: { x: number; y: number }[] = [];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (d[(y * 256 + x) * 4 + 3] > 128) pts.push({ x, y });
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.floor(Math.random() * pts.length)];
    out.push({ x: (p.x / 256 - 0.5) * box, y: (p.y / 256 - 0.5) * box });
  }
  return out;
}

/** Starts the animation; resolves to a cleanup function once the mark image is loaded. */
export async function playShootingA(cv: HTMLCanvasElement, o: ShootOpts): Promise<() => void> {
  const img = new Image();
  img.src = '/logo-mark.png';
  await img.decode().catch(() => undefined);

  const ctx = cv.getContext('2d')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const box = Math.min(W, H) * 0.46;
  const cx = W / 2;
  const cy = H / 2;
  const reach = Math.hypot(W, H);
  // streaks fly from the upper right toward the lower left, with a little spread
  const base = Math.atan2(0.62, -0.78);
  const parts: P[] = sampleMark(img, box, W < 600 ? 520 : 900).map((t) => {
    const a = base + (Math.random() - 0.5) * 0.35;
    const dist = reach * (0.55 + Math.random() * 0.6);
    return {
      tx: cx + t.x, ty: cy + t.y,
      sx: cx + t.x - Math.cos(a) * dist, sy: cy + t.y - Math.sin(a) * dist,
      delay: Math.random() * 0.45, span: 0.45 + Math.random() * 0.25, size: 0.8 + Math.random() * 1.4,
    };
  });

  // tinted copy of the mark for the final crisp reveal
  const tint = document.createElement('canvas');
  tint.width = tint.height = 512;
  const tg = tint.getContext('2d')!;
  tg.drawImage(img, 0, 0, 512, 512);
  tg.globalCompositeOperation = 'source-in';
  tg.fillStyle = o.star;
  tg.fillRect(0, 0, 512, 512);

  let raf = 0;
  let done = false;
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = now - t0;
    const k = clamp(t / o.travelMs); // overall travel progress
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.strokeStyle = o.star;
    ctx.fillStyle = o.star;
    for (const p of parts) {
      const u = clamp((k - p.delay) / p.span);
      if (u <= 0) continue;
      const e = easeOut(u);
      const x = p.sx + (p.tx - p.sx) * e;
      const y = p.sy + (p.ty - p.sy) * e;
      if (u < 1) {
        const e2 = easeOut(Math.max(0, u - 0.12)); // trail = where it was a moment ago
        ctx.globalAlpha = 0.85 * (1 - u * 0.6);
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.sx + (p.tx - p.sx) * e2, p.sy + (p.ty - p.sy) * e2);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, p.size * (u < 1 ? 0.9 : 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    const reveal = clamp((t - o.travelMs) / o.settleMs);
    if (reveal > 0) {
      ctx.globalAlpha = easeOut(reveal);
      ctx.shadowColor = o.star;
      ctx.shadowBlur = 18 * reveal;
      ctx.drawImage(tint, cx - box / 2, cy - box / 2, box, box);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (reveal >= 1 && !done) {
      done = true;
      o.onSettled?.();
    }
    if (!done) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
