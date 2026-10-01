import { createObserveModule } from '@nestjs/observe';

/**
 * Matched pair of Nest module and bootstrap instrumentation hook, bound to the
 * same configuration. `ObserveModule` is imported by `AppModule`,
 * `ObserveInstrument` is handed to `NestFactory.create` in `main.ts`.
 */
export const { ObserveModule, ObserveInstrument } = createObserveModule();

/**
 * Telemetry is only shipped when both credentials are set, and never from the
 * test suite: the agent runs a detached worker thread that would otherwise
 * outlive Jest and report test traffic to the dashboard.
 */
export function isObserveEnabled(
  get: (key: string) => string | undefined,
): boolean {
  return (
    get('NODE_ENV') !== 'test' &&
    !!get('OBSERVE_APP_KEY') &&
    !!get('OBSERVE_APP_SECRET')
  );
}
