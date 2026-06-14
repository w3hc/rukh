import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SubsService {
  private readonly logger = new Logger(SubsService.name);
  private githubToken: string;

  constructor(private readonly configService: ConfigService) {
    this.githubToken = this.configService.get<string>('GITHUB_API_TOKEN') || '';

    // Log configuration status
    if (!this.githubToken) {
      this.logger.warn(
        'GITHUB_API_TOKEN not set, GitHub sponsorship verification will fail',
      );
    }
  }

  /**
   * Check if a user is subscribed
   * @param githubUserName GitHub username
   * @param data Additional data including GitHub username
   * @returns true if the user is subscribed, false otherwise
   */
  async isSubscribed(githubUserName?: string, data?: any): Promise<boolean> {
    this.logger.debug(
      `Checking subscription for user: ${githubUserName || 'anonymous'}`,
    );

    // Skip verification if no data
    if (!data) {
      this.logger.debug('No data provided - denying access');
      return false;
    }

    try {
      // Parse data if it's a string
      let parsedData = data;
      if (typeof data === 'string') {
        try {
          parsedData = JSON.parse(data);
        } catch (error) {
          this.logger.error(`Invalid JSON data: ${error.message}`);
          return false;
        }
      }

      // Check if GitHub username is provided
      const username = githubUserName || parsedData?.githubUserName;

      if (!username) {
        this.logger.error('Missing GitHub username');
        return false;
      }

      // Check if the GitHub user is sponsoring w3hc
      const isSponsoring = await this.isGithubUserSponsoringW3hc(username);
      if (!isSponsoring) {
        this.logger.warn(`GitHub user ${username} is not sponsoring w3hc`);
        return false;
      }

      // Verification passed
      this.logger.log(
        `✅ Verification PASSED for GitHub user ${username} - granting access`,
      );
      return true;
    } catch (error) {
      this.logger.error(`Subscription check error: ${error.message}`);
      return false;
    }
  }

  /**
   * Checks if a GitHub user is sponsoring the w3hc organization with at least $5/month
   * @param githubUsername GitHub username to check
   * @returns true if the user has an active sponsorship of at least $5/month, false otherwise
   */
  private async isGithubUserSponsoringW3hc(
    githubUsername: string,
  ): Promise<boolean> {
    if (!this.githubToken) {
      this.logger.error(
        'GITHUB_API_TOKEN not set, GitHub sponsorship verification FAILED',
      );
      return false;
    }

    try {
      // GitHub GraphQL API endpoint
      const endpoint = 'https://api.github.com/graphql';

      // Enhanced GraphQL query to check sponsors with tier information
      const query = `
        query {
          user(login: "${githubUsername}") {
            sponsoring(first: 100) {
              nodes {
                ... on Organization {
                  login
                  ... on Sponsorable {
                    sponsorshipForViewerAsSponsor {
                      tier {
                        name
                        monthlyPriceInDollars
                      }
                      isActive
                    }
                  }
                }
                ... on User {
                  login
                  ... on Sponsorable {
                    sponsorshipForViewerAsSponsor {
                      tier {
                        name
                        monthlyPriceInDollars
                      }
                      isActive
                    }
                  }
                }
              }
            }
          }
        }
      `;

      // Make the API request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.githubToken}`,
          'User-Agent': 'Rukh API',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        this.logger.error(
          `GitHub API responded with status: ${response.status}`,
        );
        return false;
      }

      const data = await response.json();

      // Check for errors in response
      if (data.errors) {
        this.logger.error(
          `GitHub API returned errors: ${JSON.stringify(data.errors)}`,
        );
        return false;
      }

      // Extract sponsoring organizations and users
      const sponsoringEntities = data?.data?.user?.sponsoring?.nodes || [];

      // Log all sponsored accounts for debugging
      if (sponsoringEntities.length > 0) {
        this.logger.debug(
          `${githubUsername} is sponsoring: ${sponsoringEntities.map((e) => e.login).join(', ')}`,
        );
      } else {
        this.logger.debug(`${githubUsername} is not sponsoring anyone`);
      }

      // Check if w3hc is in the list with valid sponsorship
      let isValidSponsorship = false;
      let sponsorshipAmount = 0;
      let sponsorshipTier = '';
      let isActive = false;

      for (const entity of sponsoringEntities) {
        if (entity?.login?.toLowerCase() === 'w3hc') {
          const sponsorship = entity.sponsorshipForViewerAsSponsor;
          if (sponsorship) {
            isActive = sponsorship.isActive;
            sponsorshipAmount = sponsorship.tier?.monthlyPriceInDollars || 0;
            sponsorshipTier = sponsorship.tier?.name || 'Unknown';

            // Check if sponsorship meets criteria (>= $5 and active)
            isValidSponsorship = isActive && sponsorshipAmount >= 5;
            break; // Found w3hc, no need to check other entities
          }
        }
      }

      if (isValidSponsorship) {
        this.logger.log(
          `✅ GitHub user ${githubUsername} IS sponsoring w3hc with $${sponsorshipAmount}/month (${sponsorshipTier}) - VERIFIED`,
        );
      } else if (isActive && sponsorshipAmount > 0) {
        this.logger.warn(
          `❌ GitHub user ${githubUsername} is sponsoring w3hc but amount ($${sponsorshipAmount}/month) is less than required $5/month - REJECTED`,
        );
      } else if (sponsorshipAmount > 0) {
        this.logger.warn(
          `❌ GitHub user ${githubUsername} has an inactive sponsorship with w3hc - REJECTED`,
        );
      } else {
        this.logger.warn(
          `❌ GitHub user ${githubUsername} is not sponsoring w3hc - REJECTED`,
        );
      }

      return isValidSponsorship;
    } catch (error) {
      this.logger.error(`Error checking GitHub sponsorship: ${error.message}`);
      return false;
    }
  }
}
