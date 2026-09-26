const dns = require("dns").promises;
const net = require("net");
const { AppError } = require("./errors");

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".home.arpa",
  ".lan",
  ".test",
  ".invalid",
  ".example",
];

function addressToBigInt(address) {
  if (net.isIP(address) === 4) {
    return address.split(".").reduce((value, part) => (value << 8n) | BigInt(part), 0n);
  }

  if (net.isIP(address) !== 6) {
    return null;
  }

  let normalized = address.toLowerCase();
  const embeddedIpv4 = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embeddedIpv4) {
    const ipv4Value = addressToBigInt(embeddedIpv4[1]);
    const high = Number((ipv4Value >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4Value & 0xffffn).toString(16);
    normalized = normalized.replace(embeddedIpv4[1], `${high}:${low}`);
  }

  const halves = normalized.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length > 1
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;

  if (groups.length !== 8) {
    return null;
  }

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

function inCidr(addressValue, network, prefixLength, bitLength) {
  const networkValue = addressToBigInt(network);
  if (addressValue === null || networkValue === null) {
    return false;
  }

  const shift = BigInt(bitLength - prefixLength);
  return (addressValue >> shift) === (networkValue >> shift);
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const blockedRanges = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.88.99.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    const addressValue = addressToBigInt(address);
    return !blockedRanges.some(([network, prefix]) => inCidr(addressValue, network, prefix, 32));
  }

  if (family === 6) {
    const addressValue = addressToBigInt(address);
    if (addressValue === null || !inCidr(addressValue, "2000::", 3, 128)) {
      return false;
    }

    const blockedRanges = [
      ["2001::", 23],
      ["2001:db8::", 32],
      ["2002::", 16],
      ["3fff::", 20],
    ];
    return !blockedRanges.some(([network, prefix]) => inCidr(addressValue, network, prefix, 128));
  }

  return false;
}

function validationError(message) {
  return new AppError(message, "VALIDATION_ERROR", 400);
}

function getUnbracketedHostname(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function validateHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized === "home.arpa" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    throw validationError("Company URL hostname is not allowed");
  }

  if (net.isIP(normalized)) {
    return normalized;
  }

  const labels = normalized.split(".");
  const validDomain =
    normalized.length <= 253 &&
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );

  if (!validDomain) {
    throw validationError("Company URL hostname is invalid");
  }

  return normalized;
}

async function validateAndResolveCompanyUrl(value, lookup = dns.lookup) {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError("A company URL is required");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw validationError("Company URL is malformed");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw validationError("Company URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw validationError("Company URL must not contain credentials");
  }

  const hostname = validateHostname(getUnbracketedHostname(url.hostname));
  let addresses;

  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw validationError("Company URL hostname could not be resolved");
    }
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw validationError("Company URL hostname could not be resolved");
  }
  if (addresses.some((entry) => !entry || !isPublicAddress(entry.address))) {
    throw validationError("Company URL resolves to a restricted network address");
  }

  return {
    url,
    addresses: addresses.map(({ address }) => ({ address, family: net.isIP(address) })),
  };
}

module.exports = {
  isPublicAddress,
  validateAndResolveCompanyUrl,
};
