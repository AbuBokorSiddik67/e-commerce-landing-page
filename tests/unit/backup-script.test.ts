import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Stub the external commands. This checks orchestration only; no real dump,
// GPG encryption, database, or restore is performed by this test.
let scratch: string;
let bin: string;
let backups: string;
beforeEach(async () => {
  const root = path.resolve("tmp");
  await mkdir(root, { recursive: true });
  scratch = await mkdtemp(path.join(root, "backup-test-"));
  bin = path.join(scratch, "bin"); backups = path.join(scratch, "backups");
  await mkdir(bin);
  await writeFile(path.join(bin, "pg_dump"), '#!/usr/bin/env bash\nif [ "${FIXTURE_DUMP_FAIL:-0}" = 1 ]; then echo "fixture dump failed" >&2; exit 1; fi\nprintf "synthetic SQL fixture\\n"\n', { mode: 0o755 });
  await writeFile(path.join(bin, "gpg"), '#!/usr/bin/env bash\nset -eu\nout=""; fd=0; loop=0\nwhile [ "$#" -gt 0 ]; do case "$1" in --output) shift; out="$1";; --passphrase-fd) shift; [ "$1" = 3 ]; fd=1;; --pinentry-mode) shift; [ "$1" = loopback ]; loop=1;; --passphrase) exit 9;; esac; shift; done\n[ "$fd" = 1 ] && [ "$loop" = 1 ]; IFS= read -r password <&3; [ "$password" = fixture-backup-pass ]; cat > "$out"\n', { mode: 0o755 });
});
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

function run(extra: Record<string, string> = {}) {
  return spawnSync("bash", [path.resolve("scripts/backup.sh")], { encoding: "utf8", env: { ...process.env,
    PATH: `${bin}:${process.env.PATH}`, DATABASE_URL: "postgresql://fixture:fixture@invalid:1/fixture",
    BACKUP_PASSPHRASE: "fixture-backup-pass", BACKUP_DIR: backups, ...extra } });
}

describe("backup script orchestration", () => {
  it("uses passphrase fd, private permissions and unique complete output names", async () => {
    const first = run(); const second = run();
    expect(first.status).toBe(0); expect(second.status).toBe(0);
    const files = await readdir(backups);
    expect(files).toHaveLength(2);
    expect(files.every((file) => /^landiq-\d{8}T\d{6}Z-[a-zA-Z0-9]+\.sql\.gz\.gpg$/.test(file))).toBe(true);
    expect((await readFile(path.join(backups, files[0]))).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect((await stat(path.join(backups, files[0]))).mode & 0o777).toBe(0o600);
    expect(`${first.stdout}${first.stderr}`).not.toContain("fixture-backup-pass");
  });

  it("does not leave a misleading backup when pg_dump fails", async () => {
    const failed = run({ FIXTURE_DUMP_FAIL: "1" });
    expect(failed.status).not.toBe(0);
    expect(await readdir(backups)).toEqual([]);
  });

  it("rejects a malformed retention value before creating backups", async () => {
    expect(run({ RETENTION_DAYS: "-1" }).status).not.toBe(0);
  });
});
