import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

export const ANTHROPIC_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/**
 * Environment schema, checked once by `ConfigModule.forRoot` before any
 * provider is built. Defaults live here, so `ConfigService.get` returns a
 * typed value whether or not the variable is set. See `.env.template`.
 */
export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  MISTRAL_API_KEY: string;

  @IsString()
  @IsNotEmpty()
  ANTHROPIC_API_KEY: string;

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  DEEPSEEK_API_KEY?: string;

  @IsOptional()
  @IsIn(ANTHROPIC_EFFORT_LEVELS)
  ANTHROPIC_EFFORT?: (typeof ANTHROPIC_EFFORT_LEVELS)[number];

  @IsOptional()
  @IsString()
  TAVILY_API_KEY?: string;

  @IsInt()
  @IsPositive()
  SIWE_CHAIN_ID: number = 1;

  @IsInt()
  @IsPositive()
  SIWE_MAX_AGE_SECONDS: number = 300;

  @IsOptional()
  @IsString()
  SIWE_ALLOWED_DOMAINS?: string;

  @IsOptional()
  @IsString()
  GITHUB_API_TOKEN?: string;

  @IsOptional()
  @IsString()
  SPONSOR_GITHUB_LOGIN?: string;

  @IsInt()
  @Min(0)
  SPONSOR_MIN_MONTHLY_USD: number = 5;

  @IsOptional()
  @IsString()
  OBSERVE_APP_KEY?: string;

  @IsOptional()
  @IsString()
  OBSERVE_APP_SECRET?: string;

  @IsString()
  OBSERVE_SERVICE_ID: string = 'rukh';

  @IsOptional()
  @IsIn(['true', 'false'])
  OBSERVE_DEBUG?: string;

  @IsOptional()
  @IsString()
  NTFY_ASK_TOKEN?: string;

  @IsString()
  NTFY_ASK_TOPIC: string = 'rukh';

  @IsInt()
  @IsPositive()
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsInt()
  @IsPositive()
  THROTTLE_ASK_LIMIT: number = 1000;

  @IsInt()
  @IsPositive()
  THROTTLE_WEB_LIMIT: number = 200;
}

/**
 * `ConfigModule` validator. Empty values (`KEY=` lines from `.env.template`)
 * count as unset, so the schema defaults apply. Throws one error listing
 * every problem, which stops the app before it starts listening.
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const present = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== ''),
  );
  const env = plainToInstance(EnvironmentVariables, present, {
    enableImplicitConversion: true,
  });

  const problems = validateSync(env).map(
    (error) =>
      `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
  );
  if (!!env.OBSERVE_APP_KEY !== !!env.OBSERVE_APP_SECRET) {
    problems.push(
      'OBSERVE_APP_KEY, OBSERVE_APP_SECRET: set both to enable NestJS Observe, or neither',
    );
  }

  if (env.SPONSOR_GITHUB_LOGIN && !env.GITHUB_API_TOKEN) {
    problems.push(
      'GITHUB_API_TOKEN: required to check sponsorships of SPONSOR_GITHUB_LOGIN',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration (see .env.template):\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
  }
  return env;
}
