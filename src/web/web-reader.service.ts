import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import * as cheerio from 'cheerio';

@Injectable()
export class WebReaderService {
  private readonly logger = new Logger(WebReaderService.name);

  /**
   * Fetches the content of a webpage from a given URL
   * @param url The URL to fetch content from
   * @returns The raw HTML content of the webpage
   */
  async readWebPage(url: string): Promise<{ content: string; url: string }> {
    try {
      this.logger.log(`Fetching content from: ${url}`);

      // Validate URL
      let targetUrl: URL;
      try {
        targetUrl = new URL(url);
      } catch (error) {
        throw new HttpException('Invalid URL format', HttpStatus.BAD_REQUEST);
      }

      // Set up timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        // Fetch the web page
        const response = await fetch(targetUrl.toString(), {
          headers: {
            'User-Agent': 'Rukh Web Reader Service/1.0',
          },
          signal: controller.signal,
        });

        // Clear the timeout since we got a response
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new HttpException(
            `Failed to fetch URL: ${response.status} ${response.statusText}`,
            HttpStatus.BAD_GATEWAY,
          );
        }

        // Get the text content
        const content = await response.text();
        this.logger.log(
          `Successfully fetched ${content.length} characters from ${url}`,
        );

        return {
          content,
          url: targetUrl.toString(),
        };
      } catch (error) {
        // Make sure to clear the timeout in case of error
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error fetching URL content: ${error.message}`);

      if (error instanceof HttpException) {
        throw error;
      }

      // Handle abort errors specifically
      if (error.name === 'AbortError') {
        throw new HttpException(
          'Request timed out after 10 seconds',
          HttpStatus.REQUEST_TIMEOUT,
        );
      }

      throw new HttpException(
        `Failed to read webpage: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Extracts text and links from a webpage for LLM processing
   * @param url The URL to fetch content from
   * @returns Clean text with preserved links for LLM processing
   */
  async extractForLLM(url: string): Promise<{
    text: string;
    links: { text: string; url: string }[];
    title: string;
    url: string;
  }> {
    const { content, url: resolvedUrl } = await this.readWebPage(url);

    try {
      this.logger.log(
        `Extracting text and links for LLM processing from: ${url}`,
      );

      // Parse HTML with cheerio
      const $ = cheerio.load(content);

      // Remove scripts, styles, and other non-content elements
      $(
        'script, style, noscript, svg, iframe, meta, [aria-hidden="true"], [style*="display:none"], [style*="visibility:hidden"]',
      ).remove();

      // Get page title
      const title = $('title').text().trim();

      // Extract all links (with text and URLs)
      const links: { text: string; url: string }[] = [];
      $('a[href]').each((i, el) => {
        const $el = $(el);
        const linkText = $el.text().trim();
        let href = $el.attr('href');

        // Skip empty or fragment-only links
        if (!linkText || !href || href.startsWith('#')) {
          return;
        }

        // Convert relative URLs to absolute
        try {
          if (!href.startsWith('http')) {
            href = new URL(href, url).toString();
          }
          links.push({ text: linkText, url: href });
        } catch (e) {
          // Skip invalid URLs
          this.logger.debug(`Skipping invalid URL: ${href}`);
        }
      });

      // Extract main text content (clean and simplified)
      // Keep only the visible text content
      $('head').remove(); // Remove head completely

      // Get text content from body with preserved spacing
      let textContent = '';

      // First try to identify distinct sections to add better spacing
      const sections = [];
      $(
        'body > section, body > main, body > article, body > div:has(h1, h2, h3), body > div:has(section)',
      ).each((i, section) => {
        sections.push($(section));
      });

      // If we found logical sections, process them separately
      if (sections.length > 0) {
        sections.forEach((section, index) => {
          // Try to get a section title
          const sectionTitle = section.find('h1, h2, h3').first().text().trim();
          if (sectionTitle) {
            textContent += '\n\n## ' + sectionTitle + '\n\n';
          } else if (index > 0) {
            // Add separation between sections
            textContent += '\n\n---\n\n';
          }
        });
      }

      // Process block-level elements to preserve structure
      $('body')
        .find('h1, h2, h3, h4, h5, h6, p, div, li, td, blockquote')
        .each((i, el) => {
          const $el = $(el);
          const text = $el.text().trim();

          if (text) {
            // For headings, add importance indicator
            if (/^h[1-6]$/.test(el.tagName.toLowerCase())) {
              const level = parseInt(el.tagName.toLowerCase().substring(1));
              // Add extra spacing and formatting for headings based on their level
              textContent += '\n' + '#'.repeat(level) + ' ' + text + '\n\n';
            } else if (el.tagName.toLowerCase() === 'li') {
              textContent += '• ' + text + '\n';
            } else if (el.tagName.toLowerCase() === 'blockquote') {
              textContent += '\n> ' + text + '\n\n';
            } else if (el.tagName.toLowerCase() === 'p') {
              // Add paragraph breaks for better readability
              textContent += text + '\n\n';
            } else if (
              $el.children().length > 0 &&
              $el.children('a').length > 0
            ) {
              // Special handling for elements containing links
              textContent += text + '\n\n';
            } else if (
              $el.parent().is('div') &&
              $el.parent().children().length > 1
            ) {
              // Add spacing between sibling elements
              textContent += text + '\n\n';
            } else {
              textContent += text + ' ';
            }
          }
        });

      // Clean up the text
      textContent = textContent
        .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
        .replace(/\s{2,}/g, ' ') // Normalize spaces (without affecting newlines)
        .trim();

      this.logger.log(
        `Successfully extracted content from ${url}: ${textContent.length} chars, ${links.length} links`,
      );

      return {
        text: textContent,
        links,
        title,
        url: resolvedUrl,
      };
    } catch (error) {
      this.logger.error(`Error extracting content: ${error.message}`);
      throw new HttpException(
        `Failed to extract content: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
