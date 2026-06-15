import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer?: string;
  responseTime?: number;
}

@Injectable()
export class WebReaderService {
  private readonly logger = new Logger(WebReaderService.name);
  private browserExecutablePath: string | null = null;
  private readonly tavilyApiKey: string;
  private readonly tavilyApiUrl = 'https://api.tavily.com/search';

  constructor(private configService: ConfigService) {
    this.tavilyApiKey = this.configService.get<string>('TAVILY_API_KEY');
    if (!this.tavilyApiKey) {
      this.logger.warn('TAVILY_API_KEY not set - web search will be disabled');
    } else {
      this.logger.log('WebReaderService initialized with Tavily API');
    }
  }

  /**
   * Find Chrome/Chromium executable on the system
   */
  private findChrome(): string {
    if (this.browserExecutablePath) {
      return this.browserExecutablePath;
    }

    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ];

    for (const path of possiblePaths) {
      try {
        execSync(`test -f "${path}"`, { stdio: 'ignore' });
        this.browserExecutablePath = path;
        this.logger.log(`Found browser at: ${path}`);
        return path;
      } catch {
        continue;
      }
    }

    throw new Error('Could not find Chrome or Chromium installation');
  }

  /**
   * Extracts text and links from a webpage for LLM processing
   * @param url The URL to fetch content from
   * @param timeout Optional timeout in seconds (default: 5)
   * @returns Clean text with preserved links for LLM processing
   */
  async extractForLLM(
    url: string,
    timeout: number = 5,
  ): Promise<{
    text: string;
    links: { text: string; url: string }[];
    title: string;
    url: string;
  }> {
    let browser = null;
    try {
      this.logger.log(
        `Extracting text and links for LLM processing from: ${url}`,
      );

      // Validate URL
      let targetUrl: URL;
      try {
        targetUrl = new URL(url);
      } catch {
        throw new HttpException('Invalid URL format', HttpStatus.BAD_REQUEST);
      }

      // Launch browser with puppeteer-core
      const executablePath = this.findChrome();
      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      // Set user agent
      await page.setUserAgent('Rukh Web Reader Service/1.0');

      // Set navigation timeout
      page.setDefaultNavigationTimeout(timeout * 1000);
      page.setDefaultTimeout(timeout * 1000);

      // Navigate to the page and wait for network to be idle
      await page.goto(targetUrl.toString(), {
        waitUntil: 'networkidle2',
        timeout: timeout * 1000,
      });

      // Extract title, links, and text content using browser context
      const extracted = await page.evaluate((baseUrl) => {
        // Remove scripts, styles, and other non-content elements
        const elementsToRemove = document.querySelectorAll(
          'script, style, noscript, svg, iframe, meta, [aria-hidden="true"], [style*="display:none"], [style*="visibility:hidden"]',
        );
        elementsToRemove.forEach((el) => el.remove());

        // Get page title
        const title = document.title.trim();

        // Extract all links (with text and URLs)
        const links: { text: string; url: string }[] = [];
        document.querySelectorAll('a[href]').forEach((el) => {
          const linkText = el.textContent?.trim() || '';
          let href = el.getAttribute('href');

          // Skip empty or fragment-only links
          if (!linkText || !href || href.startsWith('#')) {
            return;
          }

          // Convert relative URLs to absolute
          try {
            if (!href.startsWith('http')) {
              href = new URL(href, baseUrl).toString();
            }
            links.push({ text: linkText, url: href });
          } catch {
            // Skip invalid URLs
          }
        });

        // Extract main text content (clean and simplified)
        const head = document.querySelector('head');
        if (head) head.remove();

        let textContent = '';

        // Process block-level elements to preserve structure
        const elements = document.querySelectorAll(
          'body h1, body h2, body h3, body h4, body h5, body h6, body p, body div, body li, body td, body blockquote',
        );

        elements.forEach((el) => {
          const text = el.textContent?.trim() || '';

          if (text) {
            const tagName = el.tagName.toLowerCase();
            // For headings, add importance indicator
            if (/^h[1-6]$/.test(tagName)) {
              const level = parseInt(tagName.substring(1));
              textContent += '\n' + '#'.repeat(level) + ' ' + text + '\n\n';
            } else if (tagName === 'li') {
              textContent += '• ' + text + '\n';
            } else if (tagName === 'blockquote') {
              textContent += '\n> ' + text + '\n\n';
            } else if (tagName === 'p') {
              textContent += text + '\n\n';
            } else if (el.children.length > 0 && el.querySelector('a')) {
              textContent += text + '\n\n';
            } else if (
              el.parentElement &&
              el.parentElement.tagName === 'DIV' &&
              el.parentElement.children.length > 1
            ) {
              textContent += text + '\n\n';
            } else {
              textContent += text + ' ';
            }
          }
        });

        // Clean up the text
        textContent = textContent
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\s{2,}/g, ' ')
          .trim();

        return { title, links, textContent };
      }, url);

      await browser.close();

      this.logger.log(
        `Successfully extracted content from ${url}: ${extracted.textContent.length} chars, ${extracted.links.length} links`,
      );

      return {
        text: extracted.textContent,
        links: extracted.links,
        title: extracted.title,
        url: targetUrl.toString(),
      };
    } catch (error) {
      if (browser) {
        await browser.close();
      }

      this.logger.error(
        `Error extracting content: ${error instanceof Error ? error.message : String(error)}`,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      // Handle timeout errors
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new HttpException(
          `Request timed out after ${timeout} seconds`,
          HttpStatus.REQUEST_TIMEOUT,
        );
      }

      throw new HttpException(
        `Failed to extract content: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Performs a web search using Tavily API
   * @param query The search query
   * @param maxResults Maximum number of results to return (default: 5)
   * @returns Search results with content optimized for LLMs
   */
  async search(query: string, maxResults: number = 5): Promise<SearchResponse> {
    if (!this.tavilyApiKey) {
      throw new HttpException(
        'Web search is not configured. Please set TAVILY_API_KEY environment variable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!query || query.trim().length === 0) {
      throw new HttpException(
        'Search query cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    const startTime = Date.now();

    try {
      this.logger.log(`Searching for: "${query}" (max results: ${maxResults})`);

      const response = await fetch(this.tavilyApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.tavilyApiKey,
          query: query,
          max_results: Math.min(maxResults, 10),
          search_depth: 'basic',
          include_answer: true,
          include_images: false,
          include_raw_content: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        this.logger.error(
          `Tavily API error: ${response.status} - ${JSON.stringify(errorData)}`,
        );

        if (response.status === 401) {
          throw new HttpException(
            'Invalid API key for web search',
            HttpStatus.UNAUTHORIZED,
          );
        }

        if (response.status === 429) {
          throw new HttpException(
            'Search rate limit exceeded',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        throw new HttpException(
          `Web search failed: ${errorData.error || 'Unknown error'}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      const results: SearchResult[] = (data.results || []).map(
        (result: any) => ({
          title: result.title,
          url: result.url,
          content: result.content,
          score: result.score,
        }),
      );

      this.logger.log(
        `Search completed: ${results.length} results in ${responseTime}ms`,
      );

      return {
        query: query,
        results: results,
        answer: data.answer,
        responseTime,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Error performing web search: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HttpException(
        `Failed to perform web search: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
