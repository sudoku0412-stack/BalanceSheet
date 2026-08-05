const jestExpoPreset = require('jest-expo/jest-preset');

module.exports = {
  projects: [
    // Pure logic (lib/) — no RN runtime needed, fast Node env.
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/android/',
        '/ios/',
        '<rootDir>/__tests__/performance/',
        '<rootDir>/__tests__/regression/',
      ],
      moduleFileExtensions: ['ts', 'tsx', 'js'],
    },
    // React component rendering — needs the RN runtime (jest-expo).
    {
      ...jestExpoPreset,
      displayName: 'component',
      rootDir: '.',
      testMatch: ['<rootDir>/__tests__/components/**/*.test.tsx'],
      testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
    },
    // Function-level benchmarks with fail thresholds — pure logic, Node env.
    {
      displayName: 'performance',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/performance/**/*.perf.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
      moduleFileExtensions: ['ts', 'tsx', 'js'],
    },
    // Locked-in coverage for previously-fixed bugs — mixed logic/component,
    // so it runs under the RN runtime (jest-expo) to support both.
    {
      ...jestExpoPreset,
      displayName: 'regression',
      rootDir: '.',
      testMatch: ['<rootDir>/__tests__/regression/**/*.test.{ts,tsx}'],
      testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
    },
  ],
};
