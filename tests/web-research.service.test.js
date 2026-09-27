const assert = require("node:assert/strict");
const test = require("node:test");

const { createWebResearchService } = require("../src/services/web-research.service");
const { validateAndResolveCompanyUrl } = require("../src/utils/url-security");

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 };

async function lookupPublic() {
  return [PUBLIC_ADDRESS];
}

function response(status, contentType, body, headers = {}) {
  return {
    status,
    headers: { "content-type": contentType, ...headers },
    body: Buffer.from(body),
  };
}

async function expectValidationFailure(url, expectedMessage) {
  await assert.rejects(
    validateAndResolveCompanyUrl(url, lookupPublic),
    (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, expectedMessage);
      return true;
    },
  );
}

test("accepts a valid HTTPS URL and resolves its hostname", async () => {
  const result = await validateAndResolveCompanyUrl("https://company.example.com/about", lookupPublic);

  assert.equal(result.url.protocol, "https:");
  assert.deepEqual(result.addresses, [PUBLIC_ADDRESS]);
});

test("accepts example.com as a valid hostname", async () => {
  const result = await validateAndResolveCompanyUrl("https://example.com", lookupPublic);

  assert.equal(result.url.hostname, "example.com");
});

test("rejects exact home.arpa", async () => {
  await expectValidationFailure("https://home.arpa", "Company URL hostname is not allowed");
});

test("rejects foo.home.arpa", async () => {
  await expectValidationFailure("https://foo.home.arpa", "Company URL hostname is not allowed");
});

test("accepts a valid HTTP URL", async () => {
  const result = await validateAndResolveCompanyUrl("http://company.example.com", lookupPublic);

  assert.equal(result.url.protocol, "http:");
});

test("rejects a missing company URL", async () => {
  await expectValidationFailure(undefined, "A company URL is required");
});

test("rejects malformed URLs", async () => {
  await expectValidationFailure("https://%", "Company URL is malformed");
  await expectValidationFailure("http://localhost:99999/acme/", "Company URL is malformed");
});

test("rejects unsupported URL schemes", async () => {
  for (const url of ["file:///etc/passwd", "ftp://company.example.com", "javascript:alert(1)", "data:text/plain,x", "gopher://host"]) {
    await expectValidationFailure(url, "Company URL must use HTTP or HTTPS");
  }
});

test("rejects localhost", async () => {
  await expectValidationFailure("http://localhost", "Company URL hostname is not allowed");
});

test("rejects localhost in production and when the environment is unspecified", async () => {
  for (const environment of ["production", undefined]) {
    await assert.rejects(
      validateAndResolveCompanyUrl("http://localhost:8099/acme/", lookupPublic, { environment }),
      (error) => error.code === "VALIDATION_ERROR" && error.message === "Company URL hostname is not allowed",
    );
  }
});

test("accepts only HTTP localhost in development and test modes", async () => {
  for (const environment of ["development", "test"]) {
    const result = await validateAndResolveCompanyUrl(
      "http://localhost:8099/acme/", lookupPublic, { environment },
    );
    assert.equal(result.url.hostname, "localhost");
    assert.equal(result.url.port, "8099");
    assert.deepEqual(result.addresses, [{ address: "127.0.0.1", family: 4 }]);
  }
});

test("keeps loopback and private IP literals blocked in development and test modes", async () => {
  for (const environment of ["development", "test"]) {
    for (const url of [
      "http://127.0.0.1:8099/acme/",
      "http://[::1]:8099/acme/",
      "http://192.168.1.10:8099/acme/",
    ]) {
      await assert.rejects(
        validateAndResolveCompanyUrl(url, lookupPublic, { environment }),
        (error) => error.code === "VALIDATION_ERROR" && error.message === "Company URL resolves to a restricted network address",
      );
    }
  }
});

test("rejects loopback and private IP literals in production", async () => {
  for (const url of [
    "http://127.0.0.1:8099/acme/",
    "http://[::1]:8099/acme/",
    "http://10.1.2.3:8099/acme/",
    "http://192.168.1.10:8099/acme/",
    "http://172.16.0.10:8099/acme/",
  ]) {
    await assert.rejects(
      validateAndResolveCompanyUrl(url, lookupPublic, { environment: "production" }),
      (error) => error.code === "VALIDATION_ERROR" && error.message === "Company URL resolves to a restricted network address",
    );
  }
});

test("rejects HTTPS localhost and credentialed localhost URLs in development", async () => {
  for (const url of [
    "https://localhost:8099/acme/",
    "http://user:pass@localhost:8099/acme/",
  ]) {
    await assert.rejects(
      validateAndResolveCompanyUrl(url, lookupPublic, { environment: "development" }),
      (error) => error.code === "VALIDATION_ERROR",
    );
  }
});

test("rejects 127.0.0.1", async () => {
  await expectValidationFailure("http://127.0.0.1", "Company URL resolves to a restricted network address");
});

test("rejects a private 192.168 IPv4 address", async () => {
  await expectValidationFailure("http://192.168.1.10", "Company URL resolves to a restricted network address");
});

test("rejects a private 10.x IPv4 address", async () => {
  await expectValidationFailure("http://10.5.4.3", "Company URL resolves to a restricted network address");
});

test("rejects IPv4 link-local addresses", async () => {
  await expectValidationFailure("http://169.254.10.20", "Company URL resolves to a restricted network address");
});

test("rejects IPv6 loopback", async () => {
  await expectValidationFailure("http://[::1]", "Company URL resolves to a restricted network address");
});

test("rejects unspecified and unique-local IPv6 addresses", async () => {
  for (const url of ["http://[::]", "http://[fc00::1]"]) {
    await expectValidationFailure(url, "Company URL resolves to a restricted network address");
  }
});

test("rejects invalid hostnames before resolving them", async () => {
  let wasResolved = false;
  const lookup = async () => {
    wasResolved = true;
    throw new Error("must not resolve");
  };

  await assert.rejects(
    validateAndResolveCompanyUrl("http://not_a_valid_host", lookup),
    (error) => error.code === "VALIDATION_ERROR" && error.message === "Company URL hostname is invalid",
  );
  assert.equal(wasResolved, false);
});

test("rejects hostnames resolving to any private answer before fetching", async () => {
  const lookup = async () => {
    return [PUBLIC_ADDRESS, { address: "10.0.0.4", family: 4 }];
  };
  let requestCount = 0;
  const service = createWebResearchService({
    lookup,
    request: async () => {
      requestCount += 1;
      return response(200, "text/html", "should not be fetched");
    },
  });

  await assert.rejects(
    service.fetchCompanyPage("https://company.example.com"),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.equal(requestCount, 0);
});

test("returns readable text from a successful HTML response as data", async () => {
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => response(
      200,
      "text/html; charset=utf-8",
      "<html><head><meta property=\"og:site_name\" content=\"Acme &amp; Co\"></head><body><h1>About us</h1><p>We build tools &amp; services.</p><script>stealSecrets()</script></body></html>",
    ),
  });
  const result = await service.fetchCompanyPage("https://company.example.com/about");

  assert.equal(result.url, "https://company.example.com/about");
  assert.equal(result.final_url, "https://company.example.com/about");
  assert.equal(result.status, 200);
  assert.equal(result.content_type, "text/html");
  assert.equal(result.text, "About us\nWe build tools & services.");
  assert.equal(result.site_name, "Acme & Co");
  assert.equal(result.text.includes("stealSecrets"), false);
});

test("extracts an explicit application-name metadata value", async () => {
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => response(
      200,
      "text/html",
      '<html><head><meta name="application-name" content="Acme Platform"></head><body>Text</body></html>',
    ),
  });
  const result = await service.fetchCompanyPage("https://company.example.com/");

  assert.equal(result.site_name, "Acme Platform");
});

test("fetches localhost in test mode through mocked DNS and HTTP boundaries", async () => {
  let lookupCalls = 0;
  const requests = [];
  const service = createWebResearchService({
    environment: "test",
    lookup: async () => { lookupCalls += 1; throw new Error("localhost uses the scoped loopback mapping"); },
    request: async (url, address) => {
      requests.push({ url: url.href, address });
      return response(200, "text/html", "<p>Local test site</p>");
    },
  });
  const result = await service.fetchCompanyPage("http://localhost:8099/acme/");

  assert.equal(lookupCalls, 0);
  assert.equal(result.text, "Local test site");
  assert.deepEqual(requests, [{
    url: "http://localhost:8099/acme/",
    address: { address: "127.0.0.1", family: 4 },
  }]);
});

test("accepts plain text content", async () => {
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => response(200, "text/plain; charset=utf-8", "Company profile\r\nPublic information"),
  });
  const result = await service.fetchCompanyPage("https://company.example.com/profile");

  assert.equal(result.content_type, "text/plain");
  assert.equal(result.text, "Company profile\nPublic information");
});

test("rejects non-HTML and non-text content types", async () => {
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => response(200, "application/pdf", "%PDF-1.7"),
  });

  await assert.rejects(
    service.fetchCompanyPage("https://company.example.com/file"),
    (error) => error.code === "UNSUPPORTED_CONTENT_TYPE" && error.statusCode === 415,
  );
});

test("enforces the response size limit", async () => {
  const service = createWebResearchService({
    lookup: lookupPublic,
    maxResponseBytes: 8,
    request: async () => response(200, "text/html", "<p>oversized</p>"),
  });

  await assert.rejects(
    service.fetchCompanyPage("https://company.example.com/large"),
    (error) => error.code === "RESPONSE_TOO_LARGE" && error.statusCode === 413,
  );
});

test("enforces request timeouts", async () => {
  let signal;
  const service = createWebResearchService({
    lookup: lookupPublic,
    timeoutMs: 10,
    request: async (url, address, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });

  await assert.rejects(
    service.fetchCompanyPage("https://company.example.com/slow"),
    (error) => error.code === "RESEARCH_TIMEOUT" && error.statusCode === 504,
  );
  assert.equal(signal.aborted, true);
});

test("follows a redirect to another validated public URL", async () => {
  const requestedUrls = [];
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async (url) => {
      requestedUrls.push(url.href);
      if (url.pathname === "/start") {
        return response(302, "text/plain", "", { location: "https://other.example.com/final" });
      }
      return response(200, "text/html", "<p>Final page</p>");
    },
  });
  const result = await service.fetchCompanyPage("https://company.example.com/start");

  assert.deepEqual(requestedUrls, [
    "https://company.example.com/start",
    "https://other.example.com/final",
  ]);
  assert.equal(result.final_url, "https://other.example.com/final");
  assert.equal(result.text, "Final page");
});

test("blocks a redirect to a private destination before fetching it", async () => {
  const requestedUrls = [];
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async (url) => {
      requestedUrls.push(url.href);
      return response(302, "text/plain", "", { location: "http://127.0.0.1/private" });
    },
  });

  await assert.rejects(
    service.fetchCompanyPage("https://company.example.com/redirect"),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.deepEqual(requestedUrls, ["https://company.example.com/redirect"]);
});

test("returns safe structured errors", async () => {
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => {
      throw new Error("socket failed for internal address 10.0.0.1");
    },
  });

  await assert.rejects(
    service.fetchCompanyPage("https://company.example.com"),
    (error) => {
      assert.equal(error.code, "COMPANY_FETCH_FAILED");
      assert.equal(error.statusCode, 502);
      assert.equal(error.message, "Unable to fetch company page");
      assert.equal(error.details, undefined);
      return true;
    },
  );
});

test("retries HTTP 429 with bounded exponential backoff", async () => {
  let calls = 0;
  const delays = [];
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => (++calls < 3
      ? response(429, "text/plain", "busy")
      : response(200, "text/plain", "Recovered")),
    sleep: async (delay) => delays.push(delay),
    backoffMs: 25,
  });

  const result = await service.fetchCompanyPage("https://company.example.com");
  assert.equal(result.text, "Recovered");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [25, 50]);
});

test("honors a bounded Retry-After response header", async () => {
  const delays = [];
  let calls = 0;
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => (++calls === 1
      ? response(429, "text/plain", "busy", { "retry-after": "1" })
      : response(200, "text/plain", "Recovered")),
    sleep: async (delay) => delays.push(delay),
    maxRetryAfterMs: 1000,
  });

  await service.fetchCompanyPage("https://company.example.com");
  assert.deepEqual(delays, [1000]);
});

test("returns a structured error when the bounded HTTP retries are exhausted", async () => {
  let calls = 0;
  const delays = [];
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async () => { calls += 1; return response(429, "text/plain", "busy"); },
    sleep: async (delay) => delays.push(delay),
    maxRetries: 2,
  });

  await assert.rejects(
    service.fetchCompanyPage("https://company.example.com"),
    (error) => error.code === "HTTP_RATE_LIMITED" && error.statusCode === 429,
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test("fetches robots.txt through the same validated HTTP boundary", async () => {
  const requested = [];
  const service = createWebResearchService({
    lookup: lookupPublic,
    request: async (url) => {
      requested.push(url.href);
      return response(404, "text/plain", "Not found");
    },
  });

  const result = await service.fetchRobotsTxt("https://company.example.com/path/page");
  assert.deepEqual(requested, ["https://company.example.com/robots.txt"]);
  assert.equal(result.status, 404);
});

test("does not mutate the service configuration object", async () => {
  const options = Object.freeze({
    lookup: lookupPublic,
    request: async () => response(200, "text/html", "<p>Safe</p>"),
    timeoutMs: 100,
    maxResponseBytes: 1024,
  });
  const service = createWebResearchService(options);

  await service.fetchCompanyPage("https://company.example.com");

  assert.deepEqual(Object.keys(options), ["lookup", "request", "timeoutMs", "maxResponseBytes"]);
});
