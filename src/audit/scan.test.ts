import assert from "node:assert/strict";
import test from "node:test";
import { inspectSource, parseAudit } from "./scan.js";

const advisory = { source: 999999, title: "Imports injection", url: "https://github.com/advisories/GHSA-r5fr-rjxr-66jc", severity: "high" };
const entry = { severity: "high", isDirect: true, range: "<4.18.0", fixAvailable: true, via: [advisory] };

test("matches stable advisory ID, retains inherited and unsupported findings, never infers safety", () => {
  const findings = parseAudit({ auditReportVersion: 2, vulnerabilities: {
    lodash: entry,
    parent: { ...entry, via: ["lodash"] },
    other: { ...entry, via: [{ ...advisory, url: "https://example.com/unknown" }] },
  } }, []);
  assert.equal(findings[0]?.advisories[0]?.assessment, "NEEDS_REVIEW");
  assert.equal(findings[0]?.advisories[0]?.capsule, "invoice");
  assert.deepEqual(findings[1]?.inheritedFrom, ["lodash"]);
  assert.equal(findings[2]?.advisories[0]?.assessment, "UNSUPPORTED");
});

test("malformed registry errors cannot masquerade as a zero-finding report", () => {
  assert.throws(() => parseAudit({ error: { code: "E401" } }, []));
  assert.throws(() => parseAudit({ vulnerabilities: {} }, []));
  assert.deepEqual(parseAudit({ auditReportVersion: 2, vulnerabilities: {} }, []), []);
});

test("candidate locations distinguish named aliases and namespace imports from unrelated methods", () => {
  const calls = inspectSource('import { template as compile } from "lodash";\nimport * as versions from "semver";\ncompile("x"); versions.valid("1.0.0"); res.redirect("/");', "server.ts");
  assert.deepEqual(calls.map(({ package: pkg, symbol, line }) => [pkg, symbol, line]), [["lodash", "template", 3], ["semver", "valid", 3]]);
});

test("default-import calls such as lodash.template are candidates; type-only and relative imports are not", () => {
  const source = [
    'import lodash from "lodash";',
    'import type { Options } from "lodash-types";',
    'import { local } from "./local.js";',
    'lodash.template("x"); local();',
  ].join("\n");
  const calls = inspectSource(source, "server.ts");
  assert.deepEqual(calls.map(({ package: pkg, symbol, line }) => [pkg, symbol, line]), [["lodash", "template", 4]]);
});
