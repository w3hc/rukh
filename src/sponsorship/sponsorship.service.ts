import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SPONSORING_QUERY = `
  query ($login: String!) {
    user(login: $login) {
      sponsoring(first: 100) {
        nodes {
          ... on Organization {
            login
            sponsorshipForViewerAsSponsor {
              isActive
              tier {
                monthlyPriceInDollars
              }
            }
          }
          ... on User {
            login
            sponsorshipForViewerAsSponsor {
              isActive
              tier {
                monthlyPriceInDollars
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Checks whether a GitHub user sponsors `SPONSOR_GITHUB_LOGIN` with at least
 * `SPONSOR_MIN_MONTHLY_USD` a month. Only registered when
 * {@link isSponsorshipEnabled} holds.
 */
@Injectable()
export class SponsorshipService {
  private readonly logger = new Logger(SponsorshipService.name);
  private readonly sponsoredLogin: string;
  private readonly minMonthlyUsd: number;
  private readonly githubToken: string;

  constructor(configService: ConfigService) {
    this.sponsoredLogin = configService
      .getOrThrow<string>('SPONSOR_GITHUB_LOGIN')
      .toLowerCase();
    this.minMonthlyUsd = configService.getOrThrow<number>(
      'SPONSOR_MIN_MONTHLY_USD',
    );
    this.githubToken = configService.getOrThrow<string>('GITHUB_API_TOKEN');
  }

  async isSponsor(githubUsername: string): Promise<boolean> {
    if (!githubUsername) {
      return false;
    }

    try {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.githubToken}`,
          'User-Agent': 'Rukh API',
        },
        body: JSON.stringify({
          query: SPONSORING_QUERY,
          variables: { login: githubUsername },
        }),
      });

      if (!response.ok) {
        this.logger.error(
          `GitHub API responded with status: ${response.status}`,
        );
        return false;
      }

      const data = await response.json();
      if (data.errors) {
        this.logger.error(
          `GitHub API returned errors: ${JSON.stringify(data.errors)}`,
        );
        return false;
      }

      const sponsorship = (data?.data?.user?.sponsoring?.nodes ?? []).find(
        (node) => node?.login?.toLowerCase() === this.sponsoredLogin,
      )?.sponsorshipForViewerAsSponsor;

      const amount = sponsorship?.tier?.monthlyPriceInDollars ?? 0;
      const valid = !!sponsorship?.isActive && amount >= this.minMonthlyUsd;

      this.logger.log(
        `${githubUsername} ${valid ? 'is' : 'is not'} a sponsor of ${this.sponsoredLogin} ($${amount}/month, minimum $${this.minMonthlyUsd})`,
      );
      return valid;
    } catch (error) {
      this.logger.error(
        `Error checking GitHub sponsorship: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
