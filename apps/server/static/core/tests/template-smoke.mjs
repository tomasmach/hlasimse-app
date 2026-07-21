import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "../../..");
const templateRoot = join(serverRoot, "templates");
const css = readFileSync(join(serverRoot, "static/core/css/app.css"), "utf8");

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

const templates = filesBelow(templateRoot).filter((path) => path.endsWith(".html"));
assert.ok(templates.length >= 20, "Expected the complete public, auth and dashboard template set.");

const base = readFileSync(join(templateRoot, "base.html"), "utf8");
assert.match(base, /<html lang="cs">/);
assert.match(base, /name="viewport"/);
assert.match(base, /class="skip-link"/);
assert.match(base, /id="hlavni-obsah"/);

for (const path of templates) {
  const html = readFileSync(path, "utf8");
  assert.doesNotMatch(html, /target="_blank"(?![^>]*rel="[^"]*noopener)/, `${path}: external new tabs must use noopener.`);
  assert.doesNotMatch(html, /<(button|a)[^>]*aria-label=""/, `${path}: interactive accessible names cannot be empty.`);
}

const landing = readFileSync(join(templateRoot, "core/landing.html"), "utf8");
assert.match(landing, /id="hero-title"/);
assert.match(css, /\.hero h1\{max-width:72rem/);
assert.match(landing, /nenahrazuje (tísňovou )?linky?|ne náhrada tísňové linky/i);
assert.match(landing, /best-effort/i);
assert.doesNotMatch(landing, /Premium|trial|ceník/i);
assert.match(landing, /jedné hodiny až po sedm dní/i);
assert.doesNotMatch(landing, /třicet dní|bez limitu/i);

assert.match(css, /\.bento-grid\{[^}]*grid-template-columns:repeat\(12/);
assert.match(css, /\.bento--wide\{grid-column:span 8\}/);
assert.match(css, /\.bento--narrow\{grid-column:span 4\}/);
assert.match(css, /grid-auto-flow:dense/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion:reduce/);

console.log(`Static template smoke/a11y checks passed for ${templates.length} templates.`);
