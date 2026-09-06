import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        status: {
          ok: '#16a34a',
          watch: '#ca8a04',
          approaching: '#ea580c',
          overrun: '#dc2626',
          suspended: '#991b1b',
          syncfail: '#6b7280',
        },
      },
    },
  },
  plugins: [],
};

export default config;
