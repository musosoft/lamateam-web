/** @type {import('tailwindcss').Config} */
// tailwind.config.mjs
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx,vue}"],
  theme: {
    extend: {},
  },
  plugins: [
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
