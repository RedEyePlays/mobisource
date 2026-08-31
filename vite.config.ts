/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    // Rules and integration tests share one Firestore emulator and each
    // wipes all data in afterEach — running test files in parallel lets
    // one file's cleanup interfere mid-test with another's. This was
    // very likely the cause of an earlier "flaky" rules test run too.
    fileParallelism: false,
  },
})
