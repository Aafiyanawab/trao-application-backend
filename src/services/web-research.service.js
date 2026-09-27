const dns = require("dns").promises;
const http = require("http");
const https = require("https");

const { AppError } = require("../utils/errors");
const { validateAndResolveCompanyUrl } = require("../utils/url-security");

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 100;
const DEFAULT_MAX_RETRY_AFTER_MS = 2000;
const MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

function fetchError(code, message, statusCode = 502) {
  return new AppError(message, code, statusCode);
}

function decodeHtmlEntities(text) {
  return text.replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
    const lowerName = name.toLowerCase();
    const named = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    if (Object.prototype.hasOwnProperty.call(named, lowerName)) {
      return named[lowerName];
    }

    const codePoint = lowerName.startsWith("#x")
      ? Number.parseInt(lowerName.slice(2), 16)
      : Number.parseInt(lowerName.slice(1), 10);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
      return entity;
    }

    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  });
}

function extractReadableText(content, contentType) {
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  const source = content.toString("utf8");
  if (mediaType === "text/plain") {
    return source.replace(/\r\n?/g, "\n").trim();
  }

  return decodeHtmlEntities(
    source
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

function extractPageMetadata(content, contentType) {
  if (contentType === "text/plain") {
    return { title: "", site_name: "", headings: [], links: [] };
  }

  const html = content.toString("utf8");
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  let siteName = "";
  const metaPattern = /<meta\b([^>]*)>/gi;
  let metaMatch;
  while ((metaMatch = metaPattern.exec(html)) !== null && !siteName) {
    const attributes = {};
    const attributePattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let attributeMatch;
    while ((attributeMatch = attributePattern.exec(metaMatch[1])) !== null) {
      attributes[attributeMatch[1].toLowerCase()] = decodeHtmlEntities(attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4]);
    }
    if (attributes.property?.toLowerCase() === "og:site_name" || attributes.name?.toLowerCase() === "application-name") {
      siteName = (attributes.content || "").trim();
    }
  }
  const headings = [];
  const headingPattern = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    const heading = extractReadableText(Buffer.from(headingMatch[1]), contentType);
    if (heading) headings.push(heading);
  }

  const links = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorPattern.exec(html)) !== null) {
    const hrefMatch = anchorMatch[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const href = hrefMatch && decodeHtmlEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]).trim();
    const text = extractReadableText(Buffer.from(anchorMatch[2]), contentType);
    if (href) links.push({ href, text });
  }

  return {
    title: titleMatch
      ? extractReadableText(Buffer.from(titleMatch[1]), contentType)
      : "",
    site_name: siteName,
    headings,
    links,
  };
}

function createPinnedLookup(address) {
  return (hostname, options, callback) => {
    const result = { address: address.address, family: address.family };
    if (options && options.all) {
      callback(null, [result]);
    } else {
      callback(null, result.address, result.family);
    }
  };
}

function defaultRequest(url, address, { signal, maxResponseBytes }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: "GET",
        headers: {
          accept: "text/html, application/xhtml+xml, text/plain;q=0.9",
          "user-agent": "TRAO-ResearchFetcher/1.0",
        },
        lookup: createPinnedLookup(address),
        signal,
      },
      (response) => {
        const chunks = [];
        let receivedBytes = 0;
        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxResponseBytes) {
            response.destroy(fetchError("RESPONSE_TOO_LARGE", "Company page exceeds the response size limit", 413));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", (error) => reject(error));
        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function abortableRequest(requestImpl, url, address, maxResponseBytes, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  const requestPromise = Promise.resolve().then(() =>
    requestImpl(url, address, { signal: controller.signal, maxResponseBytes }),
  );
  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(fetchError("RESEARCH_TIMEOUT", "Company page request timed out", 504));
    }, timeoutMs);
  });

  return Promise.race([requestPromise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function retryAfterDelay(headers, now) {
  const value = headerValue(headers, "retry-after");
  if (typeof value !== "string" && typeof value !== "number") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now()) : null;
}

function validateOptions({ timeoutMs, maxResponseBytes, maxRetries, backoffMs, maxRetryAfterMs }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new TypeError("maxResponseBytes must be a positive integer");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new TypeError("maxRetries must be an integer between 0 and 5");
  }
  if (!Number.isInteger(backoffMs) || backoffMs < 0 || backoffMs > 5000) {
    throw new TypeError("backoffMs must be an integer between 0 and 5000");
  }
  if (!Number.isInteger(maxRetryAfterMs) || maxRetryAfterMs < 0 || maxRetryAfterMs > 10000) {
    throw new TypeError("maxRetryAfterMs must be an integer between 0 and 10000");
  }
}

function createWebResearchService({
  lookup = dns.lookup,
  request = defaultRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  maxRedirects = MAX_REDIRECTS,
  environment = process.env.NODE_ENV,
  maxRetries = DEFAULT_MAX_RETRIES,
  backoffMs = DEFAULT_BACKOFF_MS,
  maxRetryAfterMs = DEFAULT_MAX_RETRY_AFTER_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
} = {}) {
  validateOptions({ timeoutMs, maxResponseBytes, maxRetries, backoffMs, maxRetryAfterMs });
  if (typeof sleep !== "function") throw new TypeError("sleep must be a function");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError("maxRedirects must be a non-negative integer");
  }

  async function makeRequestWithRetries(url, address) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await abortableRequest(request, url, address, maxResponseBytes, timeoutMs);
      if (response?.status !== 429) return response;
      if (attempt >= maxRetries) {
        throw fetchError("HTTP_RATE_LIMITED", "Company page request was rate limited", 429);
      }
      const retryAfter = retryAfterDelay(response.headers, now);
      const delay = retryAfter ?? Math.min(backoffMs * (2 ** attempt), maxRetryAfterMs);
      if (delay > maxRetryAfterMs) {
        throw fetchError("HTTP_RATE_LIMITED", "Company page request was rate limited", 429);
      }
      await sleep(delay);
    }
  }

  async function fetchPage(value, { returnHttpErrors = false } = {}) {
    let current = await validateAndResolveCompanyUrl(value, lookup, { environment });
    const initialUrl = current.url.href;

    for (let redirectCount = 0; ; redirectCount += 1) {
      const address = current.addresses[0];
      let response;
      try {
        response = await makeRequestWithRetries(current.url, address);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw fetchError("COMPANY_FETCH_FAILED", "Unable to fetch company page");
      }

      const status = response.status;
      const location = response.headers?.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        if (redirectCount >= maxRedirects) {
          throw fetchError("TOO_MANY_REDIRECTS", "Company page exceeded the redirect limit");
        }

        let nextUrl;
        try {
          nextUrl = new URL(location, current.url);
        } catch {
          throw fetchError("INVALID_REDIRECT", "Company page returned an invalid redirect");
        }
        current = await validateAndResolveCompanyUrl(nextUrl.href, lookup, { environment });
        continue;
      }

      if (status < 200 || status >= 300) {
        if (returnHttpErrors) {
          return {
            url: initialUrl,
            final_url: current.url.href,
            status,
            content_type: null,
            text: "",
            title: "",
            site_name: "",
            headings: [],
            links: [],
          };
        }
        throw fetchError("COMPANY_FETCH_FAILED", "Company page could not be retrieved");
      }

      const contentTypeHeader = response.headers?.["content-type"];
      const contentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader[0]
        : contentTypeHeader;
      if (typeof contentType !== "string") {
        throw fetchError("UNSUPPORTED_CONTENT_TYPE", "Company page has an unsupported content type", 415);
      }

      const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(mediaType)) {
        throw fetchError("UNSUPPORTED_CONTENT_TYPE", "Company page has an unsupported content type", 415);
      }

      const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || "");
      if (body.length > maxResponseBytes) {
        throw fetchError("RESPONSE_TOO_LARGE", "Company page exceeds the response size limit", 413);
      }

      return {
        url: initialUrl,
        final_url: current.url.href,
        status,
        content_type: mediaType,
        text: extractReadableText(body, mediaType),
        ...extractPageMetadata(body, mediaType),
      };
    }
  }

  async function fetchCompanyPage(value) {
    return fetchPage(value);
  }

  async function fetchRobotsTxt(value) {
    let robotsUrl;
    try {
      robotsUrl = new URL(value);
      robotsUrl.pathname = "/robots.txt";
      robotsUrl.search = "";
      robotsUrl.hash = "";
    } catch {
      throw fetchError("INVALID_ROBOTS_URL", "Company robots URL is invalid", 400);
    }
    return fetchPage(robotsUrl.href, { returnHttpErrors: true });
  }

  return {
    fetchCompanyPage,
    fetchRobotsTxt,
  };
}

const defaultService = createWebResearchService();

module.exports = {
  createWebResearchService,
  fetchCompanyPage: defaultService.fetchCompanyPage,
  fetchRobotsTxt: defaultService.fetchRobotsTxt,
};
