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
  coverageProvider: 'v8',
  testEnvironment: 'node',
  transformIgnorePatterns: ['node_modules/(?!(.*uuid|puppeteer-core))'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
    '^@langchain/mistralai$': '<rootDir>/__mocks__/@langchain/mistralai.ts',
    '^puppeteer-core$': '<rootDir>/__mocks__/puppeteer-core.ts',
    '^@nestjs/observe$': '<rootDir>/__mocks__/@nestjs/observe.ts',
  },
  silent: true,
};

export default config;
