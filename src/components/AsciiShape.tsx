"use client";

import { useEffect, useRef } from "react";

const RAMP = " .:-=+*#%@";
type Point = [number, number, number, number, number, number, number];
export type ShapeName = "clock" | "coin" | "envelope" | "lock" | "plane";

const near = (a: number, b: number, w: number) => Math.abs(a - b) < w;
function inPoly(x: number, y: number, p: number[][]) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
const PLANE = [[1, 0.75], [-1, 0.1], [-0.4, -0.12], [-0.15, -0.75], [0.1, -0.3]];

/** Each shape is a flat silhouette in -1..1, with gaps cut out for its details. */
const MASK: Record<ShapeName, (x: number, y: number) => boolean> = {
  clock: (x, y) => {
    const r = Math.hypot(x, y);
    if (r > 0.98 || near(r, 0.84, 0.035)) return false;
    const hour = near(x, 0, 0.05) && y > -0.04 && y < 0.5;
    const minute = near(y, 0, 0.05) && x > -0.04 && x < 0.65;
    return !(hour || minute);
  },
  coin: (x, y) => {
    const r = Math.hypot(x, y);
    if (r > 0.98 || near(r, 0.8, 0.035)) return false;
    const top = near(Math.hypot(x, y - 0.2), 0.22, 0.06) && !(x > 0 && y < 0.25);
    const bottom = near(Math.hypot(x, y + 0.2), 0.22, 0.06) && !(x < 0 && y > -0.25);
    return !(top || bottom || (near(x, 0, 0.05) && Math.abs(y) < 0.6));
  },
  envelope: (x, y) => Math.abs(x) < 1 && Math.abs(y) < 0.7 && !near(y, 0.7 - 0.75 * (1 - Math.abs(x)), 0.05) && !(near(y, -0.7 + 0.5 * (1 - Math.abs(x)), 0.04) && Math.abs(x) > 0.45),
  lock: (x, y) => {
    if (Math.abs(x) < 0.65 && y > -0.9 && y < 0.1) return !(Math.hypot(x, y + 0.3) < 0.14 || (near(x, 0, 0.05) && y > -0.62 && y < -0.3));
    return y >= 0.1 && near(Math.hypot(x, y - 0.1), 0.42, 0.11);
  },
  plane: (x, y) => inPoly(x, y, PLANE) && !near(y - 0.75, ((x - 1) * 0.87) / 1.4, 0.03),
};

function points(shape: ShapeName, t: number, step: number): Point[] {
  const out: Point[] = [];
  for (let x = -1; x <= 1; x += step) for (let y = -1; y <= 1; y += step * 1.5) {
    if (!MASK[shape](x, y)) continue;
    const gloss = 0.3 * Math.sin(2.5 * x + 1.5 * y + t * 2.5);
    out.push([x, y, -0.1, 0, 0, -1, gloss], [x, y, 0.1, 0, 0, 1, gloss]);
  }
  return out;
}

/** A gently swaying shape drawn in text. Only animates while on screen. */
export function AsciiShape({ shape, cols = 52, rows = 26, speed = 1, className = "" }: { shape: ShapeName; cols?: number; rows?: number; speed?: number; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = 0, t = Math.random() * 6, on = true;
    const render = () => {
      const A = Math.sin(t) * 0.25, B = Math.sin(t * 0.7) * 0.6, ca = Math.cos(A), sa = Math.sin(A), cb = Math.cos(B), sb = Math.sin(B);
      const chars = new Array(cols * rows).fill(" ");
      const depth = new Float32Array(cols * rows);
      const k = Math.min(cols, rows * 2) * 1.7;
      for (const [x, y, z, nx, ny, nz, gloss] of points(shape, t, Math.min(0.022, 2 / k))) {
        const rot = (a: number, b: number, c: number) => { const y1 = b * ca - c * sa, z1 = b * sa + c * ca; return [a * cb + z1 * sb, y1, z1 * cb - a * sb]; };
        const [px, py, pz] = rot(x, y, z), [, ly, lz] = rot(nx, ny, nz);
        const ooz = 1 / (pz + 3.6);
        const c = Math.floor(cols / 2 + k * ooz * px), r = Math.floor(rows / 2 - k * 0.5 * ooz * py);
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const i = r * cols + c;
        if (ooz > depth[i]) {
          depth[i] = ooz;
          const l = Math.min(0.99, Math.max(0.12, 0.55 * ly - 0.65 * lz + gloss));
          chars[i] = RAMP[Math.max(1, Math.floor(l * RAMP.length))];
        }
      }
      let s = "";
      for (let r = 0; r < rows; r++) s += chars.slice(r * cols, (r + 1) * cols).join("") + "\n";
      el.textContent = s;
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 50) return;
      t += ((now - last) / 1000) * 0.6 * speed;
      last = now;
      render();
    };
    render();
    const io = new IntersectionObserver(([e]) => {
      on = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (on && !still) { last = performance.now(); raf = requestAnimationFrame(loop); }
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [shape, cols, rows, speed]);
  return <pre ref={ref} aria-hidden className={`select-none overflow-hidden font-mono text-[7px] leading-[8px] text-ink sm:text-[8px] sm:leading-[9px] ${className}`} />;
}
