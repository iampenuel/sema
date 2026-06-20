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
        ink: "#102033",
        muted: "#627386",
        paper: "#f6fafc",
        sage: "#2f7d67",
        clay: "#b84a4a",
        blue: "#2f6fa3",
        "sema-blue": "#2f6fa3",
        "sema-blue-dark": "#1f5f99",
        "sema-pale": "#eaf5fb",
        "sema-border": "#c8d8e5",
        "sema-slate": "#53687a",
        "sema-green": "#2f7d67"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(16, 32, 51, 0.10)",
        card: "0 12px 34px rgba(31, 95, 153, 0.08)",
        blue: "0 12px 30px rgba(47, 111, 163, 0.24)",
        packet: "0 28px 60px rgba(31, 95, 153, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
