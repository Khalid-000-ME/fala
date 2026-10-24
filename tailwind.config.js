/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0a",
        mute: "#7a7a7a",
        card: "#f5f5f5",
        line: "#e3e3e3",
        accent: "#e8527a",
        ok: "#18864b",
        bad: "#d92d20",
        warn: "#b86e00",
        info: "#2563eb",
      },
      fontFamily: {
        sans: ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { card: "28px", tile: "40px" },
      letterSpacing: { tightest: "-0.035em" },
    },
  },
  plugins: [],
};
