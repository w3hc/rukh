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
export function isObserveEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'test' &&
    !!process.env.OBSERVE_APP_KEY &&
    !!process.env.OBSERVE_APP_SECRET
  );
}
