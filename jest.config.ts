import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/server.ts',
    '!src/app.ts'
  ],
  coverageDirectory: 'coverage',
};

export default config;
