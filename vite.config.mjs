import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // The browser only talks to this origin; /api goes to the RoleMatch server.
    proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8787' },   // API_TARGET lets a throw-away test server stand in for the real one
    // the backend lives in its own folder with its own build and test output (server/data); changes there never need the website to reload
    watch: { ignored: ['**/server/**'] },
  },
})
