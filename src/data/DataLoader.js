/**
 * Custom error for data loading failures.
 */
export class DataLoadError extends Error {
  /**
   * @param {string} message
   * @param {string} url
   * @param {number} status
   */
  constructor(message, url, status) {
    super(message);
    this.name = 'DataLoadError';
    this.url = url;
    this.status = status;
  }
}

/**
 * Generic data loader with caching and error handling.
 */
export class DataLoader {
  #cache = new Map();
  #pending = new Map();

  /**
   * Load JSON from URL (cached, deduped).
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<any>} Parsed JSON
   */
  async load(url, options = {}) {
    if (this.#cache.has(url)) {
      return this.#cache.get(url);
    }

    if (this.#pending.has(url)) {
      return this.#pending.get(url);
    }

    const promise = this.#fetch(url, options);
    this.#pending.set(url, promise);

    try {
      const data = await promise;
      this.#cache.set(url, data);
      return data;
    } finally {
      this.#pending.delete(url);
    }
  }

  async #fetch(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new DataLoadError(`Failed to load ${url}: ${response.status}`, url, response.status);
    }

    const contentType = response.headers?.get?.('content-type') || '';
    const isGzipType =
      contentType.includes('application/gzip') || contentType.includes('application/x-gzip');
    const isLikelyGzip = isGzipType || url.endsWith('.gz');

    if (!isLikelyGzip) {
      return response.json();
    }

    const clone = response.clone();
    try {
      return await clone.json();
    } catch {
      return await this.#readGzipJson(response, url);
    }
  }

  async #readGzipJson(response, url) {
    if (typeof DecompressionStream === 'undefined') {
      throw new DataLoadError('Browser does not support gzip decompression', url, response.status);
    }

    const buffer = await response.arrayBuffer();
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  }

  /**
   * Clear cache (all or specific URL).
   * @param {string} [url]
   */
  clearCache(url) {
    if (url) {
      this.#cache.delete(url);
      return;
    }
    this.#cache.clear();
  }

  /**
   * Check if URL is cached.
   * @param {string} url
   * @returns {boolean}
   */
  isCached(url) {
    return this.#cache.has(url);
  }
}
