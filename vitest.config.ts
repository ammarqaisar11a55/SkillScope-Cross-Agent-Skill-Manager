import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['tests/**/*.test.ts'],
          exclude: process.env.SKILLSCOPE_LIVE_REGISTRY ? [] : ['tests/integration/**'],
          environment: 'node',
          testTimeout: 20000,
        },
      },
      {
        test: {
          name: 'desktop',
          root: './apps/desktop',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
    ],
  },
});
