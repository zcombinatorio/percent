/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        'ibm-plex-mono': ['var(--font-ibm-plex-mono)', 'monospace'],
        'roboto-mono': ['var(--font-roboto-mono)', 'monospace'],
        'rinter': ['var(--font-rinter)', 'monospace'],
        'supply-mono': ['var(--font-supply-mono)', 'monospace'],
        'supply-sans': ['var(--font-supply-sans)', 'sans-serif'],
      },
      colors: {
        orange: {
          500: '#EF6400',
          600: '#D65A00',
          400: '#FF7519',
        },
        green: {
          500: 'hsla(145, 100%, 39%, 1)',
          600: 'hsla(145, 100%, 34%, 1)',
          400: 'hsla(145, 100%, 44%, 1)',
        },
        red: {
          500: 'hsla(0, 100%, 60%, 1)',
          600: 'hsla(0, 100%, 55%, 1)',
          400: 'hsla(0, 100%, 65%, 1)',
        },
        'percent-orange': '#EF6300',
        'percent-black': '#000000',
      },
      animation: {
        'toggle1': 'toggle1 1.4s infinite steps(2, end)',
        'toggle2': 'toggle2 1.4s infinite steps(2, end)',
      },
      keyframes: {
        toggle1: {
          '0%, 49.99%': { visibility: 'visible' },
          '50%, 100%': { visibility: 'hidden' }
        },
        toggle2: {
          '0%, 49.99%': { visibility: 'hidden' },
          '50%, 100%': { visibility: 'visible' }
        }
      }
    },
  },
  plugins: [],
}