import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(new URL("../../", import.meta.url).pathname);

async function executable(directory, name, source) {
  const target = path.join(directory, name);
  await writeFile(target, `#!/usr/bin/env bash\nset -euo pipefail\n${source}\n`, { mode: 0o755 });
}

test("backup helper encrypts the stream before persistence and writes a checksum", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hlasimse-backup-helper-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const output = path.join(root, "output");
  await Promise.all([mkdir(bin), mkdir(output)]);
  await executable(bin, "pg_dump", "printf 'raw-database-stream'");
  await executable(
    bin,
    "age",
    `output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --recipient) shift 2 ;;
    *) shift ;;
  esac
done
printf 'encrypted:' > "$output"
cat >> "$output"`,
  );

  await execFileAsync("bash", ["scripts/ops/backup-postgres-encrypted.sh"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "postgresql://rehearsal.invalid/database",
      AGE_RECIPIENT: "age1test",
      BACKUP_OUTPUT_DIR: output,
    },
  });

  const files = (await readdir(output)).sort();
  assert.equal(files.length, 2);
  const encryptedName = files.find((name) => name.endsWith(".dump.age"));
  assert(encryptedName);
  assert(files.includes(`${encryptedName}.sha256`));
  assert.equal((await readFile(path.join(output, encryptedName), "utf8")), "encrypted:raw-database-stream");
  assert(!files.some((name) => name.endsWith(".dump") || name.endsWith(".partial")));
});

test("restore helper verifies the target before streaming into pg_restore", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hlasimse-restore-helper-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const encrypted = path.join(root, "backup.dump.age");
  const checksum = `${encrypted}.sha256`;
  const identity = path.join(root, "identity.txt");
  const marker = path.join(root, "restored.txt");
  const encryptedBytes = Buffer.from("encrypted-backup");
  await writeFile(encrypted, encryptedBytes);
  await writeFile(
    checksum,
    `${createHash("sha256").update(encryptedBytes).digest("hex")}  backup.dump.age\n`,
  );
  await writeFile(identity, "test identity");
  await executable(bin, "age", "cat \"${@: -1}\"");
  await executable(bin, "pg_restore", "cat > \"$FAKE_RESTORE_MARKER\"");
  await executable(bin, "uv", "exit 0");
  await executable(
    bin,
    "psql",
    `query=''
for argument in "$@"; do
  case "$argument" in --command=*) query="\${argument#--command=}" ;; esac
done
case "$query" in
  *current_database*) printf '%s\\n' "$RESTORE_EXPECTED_DATABASE" ;;
  *pg_catalog.pg_class*) printf '0\\n' ;;
  *pg_catalog.pg_constraint*) printf '0\\n' ;;
  *json_build_object*) printf '{"users":1}\\n' ;;
  *) exit 1 ;;
esac`,
  );

  await execFileAsync("bash", ["scripts/ops/restore-and-verify-encrypted-backup.sh"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ENCRYPTED_BACKUP_FILE: encrypted,
      BACKUP_SHA256_FILE: checksum,
      AGE_IDENTITY_FILE: identity,
      RESTORE_DATABASE_URL: "postgresql://restore.invalid/hlasimse_restore_rehearsal",
      RESTORE_EXPECTED_DATABASE: "hlasimse_restore_rehearsal",
      FAKE_RESTORE_MARKER: marker,
    },
  });
  assert.equal(await readFile(marker, "utf8"), "encrypted-backup");
});
