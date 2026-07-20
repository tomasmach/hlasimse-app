import { createInterface } from "node:readline";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const value = process.env.E2E_REDACTION_VALUE;
if (!value) {
  throw new Error("E2E_REDACTION_VALUE is required");
}

const replacement = "[REDACTED-RUN-CREDENTIAL]";
const textExtensions = new Set([
  ".json",
  ".log",
  ".properties",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

async function redactDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await redactDirectory(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name).toLowerCase())) continue;
    const original = await readFile(path, "utf8");
    if (original.includes(value)) {
      await writeFile(path, original.replaceAll(value, replacement), "utf8");
    }
  }
}

if (process.argv[2] === "--stream") {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    process.stdout.write(`${line.replaceAll(value, replacement)}\n`);
  }
} else if (process.argv[2] === "--directory" && process.argv[3]) {
  await redactDirectory(process.argv[3]);
} else {
  throw new Error("Use --stream or --directory <path>");
}
