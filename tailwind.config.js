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
        peach: "#FFAB91",
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
        success: "#4ADE80",
      },
      fontFamily: {
        display: ["Lora"],
        body: ["Instrument Sans"],
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
    },
  },
  plugins: [],
};
