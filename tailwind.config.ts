import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sabana: {
          DEFAULT: "#EA580C",
          light: "#FB923C",
          dark: "#C2410C",
          50: "#FFF7ED",
          100: "#FFEDD5",
          200: "#FED7AA",
          300: "#FDBA74",
          400: "#FB923C",
          500: "#F97316",
          600: "#EA580C",
          700: "#C2410C",
          800: "#9A3412",
          900: "#7C2D12",
        },
        success: "#16A34A",
        warning: "#FACC15",
        danger: "#DC2626",
        cream: "#FFFBEB",
        dark: {
          DEFAULT: "#121212",
          50: "#1E1E1E",
          100: "#2D2D2D",
          200: "#3D3D3D",
          300: "#4D4D4D",
          400: "#6D6D6D",
          500: "#8D8D8D",
          600: "#ADADAD",
          700: "#CDCDCD",
          800: "#E5E5E5",
          900: "#F5F5F5",
        },
      },
      fontFamily: {
        heading: ["Poppins", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        receipt: ["Courier New", "monospace"],
      },
      fontSize: {
        "numpad": ["2rem", { lineHeight: "1", fontWeight: "600" }],
      },
      spacing: {
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
      },
      animation: {
        "slide-up": "slideUp 0.3s ease-out",
        "slide-down": "slideDown 0.3s ease-out",
        "fade-in": "fadeIn 0.2s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "pop": "pop 0.3s ease-out",
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        slideDown: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        pop: {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.1)" },
          "100%": { transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
