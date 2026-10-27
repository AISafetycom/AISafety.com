import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests for pure modules only (no DOM, no Next runtime). Files end in
// .test.ts and live next to what they test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `npm run build` runs these tests on Vercel too, where VERCEL_ENV is
    // "production" for the live site's build. Start every test outside the
    // live site, as on CI and locally; a test that needs it stubs it itself.
    env: { VERCEL_ENV: '' },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
