import fs from "node:fs";
import path from "node:path";

const [artifactRoot, ...expectedKeys] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`[e2e] ${message}\n`);
  process.exit(1);
}

if (!artifactRoot || expectedKeys.length === 0) {
  fail("Usage: assert-junit-evidence.mjs <artifact-root> <evidence-key>...");
}

for (const key of expectedKeys) {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) fail(`Invalid evidence key: ${key}`);
}

if (new Set(expectedKeys).size !== expectedKeys.length) {
  fail("Expected JUnit evidence keys contain duplicates.");
}

const maestroRoot = path.join(artifactRoot, "maestro");
if (!fs.existsSync(maestroRoot)) fail(`Missing Maestro evidence directory: ${maestroRoot}`);

const actualKeys = fs.readdirSync(maestroRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sortedExpected = [...expectedKeys].sort();

if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpected)) {
  fail(`JUnit evidence set mismatch. Expected ${sortedExpected.join(", ")}; found ${actualKeys.join(", ")}.`);
}

let totalTests = 0;
for (const key of expectedKeys) {
  const outputRoot = path.join(maestroRoot, key);
  const reportPath = path.join(outputRoot, "report.xml");
  const logPath = path.join(outputRoot, "maestro.log");
  if (!fs.existsSync(reportPath)) fail(`Missing JUnit report for ${key}.`);
  if (!fs.existsSync(logPath)) fail(`Missing redacted Maestro log for ${key}.`);

  const xml = fs.readFileSync(reportPath, "utf8");
  const suites = [...xml.matchAll(/<testsuite\b([^>]*)>/g)];
  if (suites.length === 0) fail(`No testsuite found in ${reportPath}.`);

  let reportTests = 0;
  let reportFailures = 0;
  let reportErrors = 0;
  for (const [, attributes] of suites) {
    const readNumber = (name, fallback = null) => {
      const match = attributes.match(new RegExp(`\\b${name}="(\\d+)"`));
      return match ? Number(match[1]) : fallback;
    };
    const tests = readNumber("tests");
    if (tests === null) fail(`Testsuite in ${reportPath} has no tests count.`);
    reportTests += tests;
    reportFailures += readNumber("failures", 0);
    reportErrors += readNumber("errors", 0);
  }

  const testcaseCount = (xml.match(/<testcase\b/g) ?? []).length;
  if (reportTests !== 1 || testcaseCount !== 1) {
    fail(`Each Maestro flow must produce exactly one JUnit testcase for ${key}: suites=${reportTests}, testcases=${testcaseCount}.`);
  }
  if (reportFailures !== 0 || reportErrors !== 0 || /<(?:failure|error)\b/.test(xml)) {
    fail(`JUnit evidence contains a failure or error for ${key}.`);
  }
  const statuses = [...xml.matchAll(/<testcase\b[^>]*\bstatus="([^"]+)"/g)].map((match) => match[1]);
  if (statuses.length !== testcaseCount || statuses.some((status) => status !== "SUCCESS")) {
    fail(`JUnit evidence has a non-success or missing testcase status for ${key}.`);
  }
  totalTests += reportTests;
}

process.stdout.write(`${JSON.stringify({
  evidence_keys: expectedKeys,
  report_count: expectedKeys.length,
  test_count: totalTests,
  failures: 0,
  errors: 0,
})}\n`);
