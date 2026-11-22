module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  modulePathIgnorePatterns: ['<rootDir>/lib/', '<rootDir>/example/'],
  // Source files import each other with `.js` extensions for Node ESM; Jest
  // resolves the TypeScript files behind them.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // The QR round-trip property renders and decodes many codes.
  testTimeout: 60000,
};
