/** @type {import('tailwindcss').Config} */
// tailwind.config.mjs
import fluid, { extract, screens, fontSize } from "fluid-tailwind";

export default {
  content: {
    files: ["./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx,vue}"],
    extract,
  },
  theme: {
    screens, // Tailwind's default screens, in `rem`
    fontSize, // Tailwind's default font sizes, in `rem` (including line heights)
    extend: {},
  },
  plugins: [
    fluid,
    function ({ addComponents }) {
      addComponents({
        ".btn": {
          "@apply flex items-center justify-center rounded-lg px-6 py-3 font-medium transition-colors bg-gray-700 hover:bg-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2":
            {},
        },
      });
    },
  ],
};
