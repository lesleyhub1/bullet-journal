/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./App.jsx", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F6F2E8",
        "paper-card": "#FBF8F1",
        ink: "#2A2620",
        "ink-faint": "#948C7C",
        rule: "#DED5C0",
      },
    },
  },
  plugins: [],
};
