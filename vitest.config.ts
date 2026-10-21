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
          exclude: ['tests/integration/**'],
          environment: 'node',
          testTimeout: 20000,
        },
      },
      {
        // Real npm registry; never part of `npm test`. Run with `npm run test:integration`.
        test: {
          name: 'integration',
          root: './packages/core',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60000,
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
