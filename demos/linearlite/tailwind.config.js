/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    screens: {
      sm: '640px',
      // => @media (min-width: 640px) { ... }

      md: '768px',
      // => @media (min-width: 768px) { ... }

      lg: '1024px',
      // => @media (min-width: 1024px) { ... }

      xl: '1280px',
      // => @media (min-width: 1280px) { ... }

      '2xl': '1536px',
      // => @media (min-width: 1536px) { ... }
    },
    // color: {
    //   // gray: colors.trueGray,
    // },
    fontFamily: {
      sans: [
        'Inter\\ UI',
        'SF\\ Pro\\ Display',
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe\\ UI',
        'Roboto',
        'Oxygen',
        'Ubuntu',
        'Cantarell',
        'Open\\ Sans',
        'Helvetica\\ Neue',
        'sans-serif',
      ],
    },
    borderWidth: {
      DEFAULT: '1px',
      0: '0',
      2: '2px',
      3: '3px',
      4: '4px',
      6: '6px',
      8: '8px',
    },
    extend: {
      boxShadow: {
        modal: 'rgb(0 0 0 / 9%) 0px 3px 12px',
        'large-modal': 'rgb(0 0 0 / 50%) 0px 16px 70px',
      },
      spacing: {
        2.5: '10px',
        4.5: '18px',
        3.5: '14px',
        34: '136px',

        70: '280px',
        140: '560px',
        100: '400px',
        175: '700px',
        53: '212px',
        90: '360px',
      },
      fontSize: {
        xxs: '0.5rem',
        xs: '0.75rem', // 12px
        sm: '0.8125rem', // 13px
        md: '0.9357rem', //15px
        14: '0.875rem',
        base: '1.0rem', // 16px
      },
      zIndex: {
        100: 100,
      },
    },
  },
  variants: {
    extend: {
      backgroundColor: ['checked'],
      borderColor: ['checked'],
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
}
