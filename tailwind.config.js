/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        coral: {
          DEFAULT: "#FF6B5B",
          light: "#FF8A7A",
          dark: "#E55A4A",
        },
        peach: {
          DEFAULT: "#FFAB91",
          light: "#FFCCBC",
        },
        cream: {
          DEFAULT: "#FFF8F5",
          dark: "#FFF0EA",
        },
        sand: "#F5E6DC",
        charcoal: {
          DEFAULT: "#2D2926",
          light: "#4A4543",
        },
        muted: "#8B7F7A",
        success: {
          DEFAULT: "#4ADE80",
          light: "#86EFAC",
        },
        warning: "#FB923C",
        error: "#F43F5E",
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
      },
      fontSize: {
        "display-lg": ["4.5rem", { lineHeight: "1", letterSpacing: "-0.02em" }],
        "display": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display-sm": ["2.25rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
      },
      boxShadow: {
        "glow-coral": "0 0 40px rgba(255, 107, 91, 0.4)",
        "glow-coral-lg": "0 0 60px rgba(255, 107, 91, 0.5)",
        "elevated": "0 4px 20px rgba(45, 41, 38, 0.08)",
        "floating": "0 8px 32px rgba(45, 41, 38, 0.12)",
      },
    },
  },
  plugins: [],
};
