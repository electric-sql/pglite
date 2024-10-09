import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    format: 'es',
  },
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        svgo: true,
        plugins: [`@svgr/plugin-svgo`, `@svgr/plugin-jsx`],
        svgoConfig: {
          plugins: [
            `preset-default`,
            `removeTitle`,
            `removeDesc`,
            `removeDoctype`,
            `cleanupIds`,
          ],
        },
      },
    }),
  ],
})
