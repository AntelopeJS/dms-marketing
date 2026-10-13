const assert = require("node:assert/strict");
const test = it;
const {
  findHostConflict,
  isValidHostname,
  normalizeHostname,
} = require("../dist/services/website-hosts");

function site(_id, name, domain, extraDomains = []) {
  return { _id, name, domain, extraDomains };
}

test("a typed domain is reduced to its bare lowercase hostname", () => {
  assert.equal(
    normalizeHostname("  HTTPS://Shop.Example.com:8443/path?q=1 "),
    "shop.example.com",
  );
  assert.equal(normalizeHostname("qa.test:8080"), "qa.test");
  assert.equal(normalizeHostname("www.Example.com."), "www.example.com");
  assert.equal(normalizeHostname("localhost"), "localhost");
});

test("only hostnames, IPs and localhost are valid", () => {
  for (const host of ["shop.example.com", "localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(isValidHostname(normalizeHostname(host)), true, host);
  }
  for (const typed of [
    "not a domain!!",
    "*.example.com",
    "",
    "-a.com",
    "null",
  ]) {
    assert.equal(isValidHostname(normalizeHostname(typed)), false, typed);
  }
});

test("a host another site declares is a conflict, tied to its field", () => {
  const sites = [
    site("shop", "Shop", "shop.example.com", ["staging.example.com"]),
    site("docs", "Docs", "docs.example.com"),
  ];
  assert.deepEqual(
    findHostConflict(site("new", "New", "www.shop.example.com"), sites),
    { field: "domain", hostname: "shop.example.com", website: sites[0] },
  );
  const extra = findHostConflict(
    site("new", "New", "new.example.com", ["staging.example.com"]),
    sites,
  );
  assert.equal(extra.field, "extraDomains");
  assert.equal(extra.website.name, "Shop");
});

test("a site never conflicts with itself, nor a subdomain with its apex", () => {
  const sites = [site("shop", "Shop", "example.com")];
  assert.equal(
    findHostConflict(site("shop", "Shop", "example.com"), sites),
    undefined,
  );
  assert.equal(
    findHostConflict(site("docs", "Docs", "docs.example.com"), sites),
    undefined,
  );
});
