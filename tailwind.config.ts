import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#667085",
        paper: "#f7fafc",
        sage: "#3f7d6b",
        clay: "#a45d45",
        blue: "#2d6cdf"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(23, 32, 51, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
