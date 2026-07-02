import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['shared/test/**/*.test.ts'] } },
      { test: { name: 'server', include: ['server/test/**/*.test.ts'], testTimeout: 20_000 } },
      {
        plugins: [],
        test: {
          name: 'web',
          include: ['web/test/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./web/test/setup.ts'],
        },
      },
    ],
    coverage: {
      include: ['shared/src/**', 'server/src/**', 'web/src/**'],
      reporter: ['text', 'html'],
    },
  },
})
