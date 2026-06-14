import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  transformIgnorePatterns: ['node_modules/(?!(.*uuid|@mistralai))'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
    '^@mistralai/mistralai$': '<rootDir>/__mocks__/@mistralai/mistralai.ts',
  },
  silent: true,
};

export default config;
