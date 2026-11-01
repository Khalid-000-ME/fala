"use client";

import { useEffect, useRef } from "react";

const RAMP = ".,-~:;=!*#%@";
type Point = [number, number, number, number, number, number];
export type ShapeName = "torus" | "blob" | "cube" | "ring";

/** Surface samples for each shape as position plus normal. `t` lets the blob breathe. */
function points(shape: ShapeName, t: number): Point[] {
  const out: Point[] = [];
  if (shape === "torus" || shape === "ring") {
    const [R, r] = shape === "torus" ? [1, 0.45] : [1.2, 0.16];
    for (let u = 0; u < 6.28; u += 0.09) for (let v = 0; v < 6.28; v += 0.16) {
      const cv = Math.cos(v), sv = Math.sin(v), cu = Math.cos(u), su = Math.sin(u);
      out.push([(R + r * cv) * cu, (R + r * cv) * su, r * sv, cv * cu, cv * su, sv]);
    }
  } else if (shape === "blob") {
    for (let u = 0; u < 3.14; u += 0.07) for (let v = 0; v < 6.28; v += 0.09) {
      const n = [Math.sin(u) * Math.cos(v), Math.sin(u) * Math.sin(v), Math.cos(u)];
      const k = 1.05 + 0.22 * Math.sin(3 * n[0] + t) * Math.cos(3 * n[1] - t * 0.7);
      out.push([n[0] * k, n[1] * k, n[2] * k, n[0], n[1], n[2]]);
    }
  } else {
    for (let a = -1; a <= 1; a += 0.06) for (let b = -1; b <= 1; b += 0.06) {
      for (const s of [-1, 1]) {
        out.push([s * 0.95, a * 0.95, b * 0.95, s, 0, 0], [a * 0.95, s * 0.95, b * 0.95, 0, s, 0], [a * 0.95, b * 0.95, s * 0.95, 0, 0, s]);
      }
    }
  }
  return out;
}

/** A slowly tumbling 3D shape drawn in text. Only animates while on screen. */
export function AsciiShape({ shape, cols = 52, rows = 26, speed = 1, className = "" }: { shape: ShapeName; cols?: number; rows?: number; speed?: number; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = 0, t = Math.random() * 6, on = true;
    const render = () => {
      const A = t * 0.7, B = t * 0.43, ca = Math.cos(A), sa = Math.sin(A), cb = Math.cos(B), sb = Math.sin(B);
      const chars = new Array(cols * rows).fill(" ");
      const depth = new Float32Array(cols * rows);
      for (const [x, y, z, nx, ny, nz] of points(shape, t)) {
        const rot = (a: number, b: number, c: number) => { const y1 = b * ca - c * sa, z1 = b * sa + c * ca; return [a * cb + z1 * sb, y1, z1 * cb - a * sb]; };
        const [px, py, pz] = rot(x, y, z), [, ly, lz] = rot(nx, ny, nz);
        const ooz = 1 / (pz + 3.6);
        const c = Math.floor(cols / 2 + cols * 0.82 * ooz * px), r = Math.floor(rows / 2 - rows * 1.62 * ooz * py * 0.56 * 1.8);
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const i = r * cols + c;
        if (ooz > depth[i]) {
          depth[i] = ooz;
          const l = Math.max(0, 0.65 * ly - 0.75 * lz);
          chars[i] = RAMP[Math.min(RAMP.length - 1, Math.floor(l * RAMP.length))];
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
  return <pre ref={ref} aria-hidden className={`select-none overflow-hidden font-mono text-[9px] leading-[10px] text-accent sm:text-[11px] sm:leading-[12px] ${className}`} />;
}
