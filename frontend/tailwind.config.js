/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{tsx,ts}",
    "./components/**/*.{tsx,ts}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0C10",
        card: "#11141A",
        card2: "#1e1e1e",
        accent: "#DDE048",
        muted: "#888888",
        "border-color": "#2a2a2a",
        pending: "#f59e0b",
        danger: "#ef4444",
        success: "#22c55e",
        "blue-score": "#5BB7FF",
        header: "#11141A",
      },
    },
  },
  plugins: [],
}
