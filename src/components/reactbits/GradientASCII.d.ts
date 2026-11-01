import type { CSSProperties } from "react";

/** Hand-written types for the react-bits component: it destructures `dpr`/`style` with no default, so inference makes them required. */
export interface GradientASCIIProps {
  colors?: string[];
  shape?: "horizon" | "pinch" | "rise" | "eclipse";
  characters?: string;
  cellSize?: number;
  density?: number;
  glyphOpacity?: number;
  glow?: number;
  depthOfField?: number;
  flicker?: number;
  softness?: number;
  scale?: number;
  flow?: number;
  speed?: number;
  gradientOpacity?: number;
  grain?: number;
  variation?: number;
  mouseInteraction?: boolean;
  scrambleRadius?: number;
  clickEffect?: "none" | "wave" | "burst";
  intro?: boolean;
  lightMode?: boolean;
  fontFamily?: string;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
}

declare const GradientASCII: (props: GradientASCIIProps) => JSX.Element;
export default GradientASCII;
