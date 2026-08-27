/**
 * `@nestjs/observe` ships as ESM only and reads `import.meta.url`, which Jest's
 * CommonJS runtime cannot load. Telemetry is disabled under test anyway (see
 * `isObserveEnabled` in src/observe.ts), so the test runs only need the shape
 * of `createObserveModule` to exist at import time.
 */
export const createObserveModule = () => {
  class ObserveModule {
    static forRoot() {
      return { module: ObserveModule, providers: [], exports: [] };
    }
    static forRootAsync() {
      return { module: ObserveModule, providers: [], exports: [] };
    }
  }

  return { ObserveModule, ObserveInstrument: undefined };
};
