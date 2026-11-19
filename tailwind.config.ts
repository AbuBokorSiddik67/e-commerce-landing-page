import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        brand: { 50: "#eef7f3", 100: "#d7ede3", 200: "#b0dbc9", 300: "#7fc2a8", 400: "#4ea283", 500: "#2f8467", 600: "#206a53", 700: "#1b5544", 800: "#174539", 900: "#133a31", 950: "#0a211c" },
        ink: { 50: "#f7f8fa", 100: "#eef0f4", 200: "#dfe3ea", 300: "#c5ccd9", 400: "#97a2b6", 500: "#6d7a91", 600: "#536075", 700: "#414c5e", 800: "#2e3746", 900: "#1b2230", 950: "#0d121c" },
        gold: { 400: "#e8bc63", 500: "#d7a444", 600: "#b9862b" }
      },
      fontFamily: { sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"], display: ["var(--font-display)", "Georgia", "serif"] },
      boxShadow: { soft: "0 20px 60px -30px rgba(15, 30, 25, 0.35)", card: "0 1px 2px rgba(16,24,40,.04), 0 8px 24px -12px rgba(16,24,40,.12)" },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      keyframes: { "fade-up": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } } },
      animation: { "fade-up": "fade-up .4s ease-out both" }
    }
  },
  plugins: []
};

export default config;
