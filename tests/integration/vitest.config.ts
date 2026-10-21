import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/global-setup.ts'],
    // Files share one database and the cron functions scan every game: run them one at a time.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
