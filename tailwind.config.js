/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: Object.fromEntries(["canvas", "ink", "mute", "card", "line", "accent", "ok", "bad", "warn", "info"].map((c) => [c, `rgb(var(--${c}) / <alpha-value>)`])),
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { card: "20px", tile: "40px" },
      letterSpacing: { tightest: "-0.035em" },
    },
  },
  plugins: [],
};
