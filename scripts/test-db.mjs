/*
 * Runs the PostgreSQL integration tests against a REAL, throwaway PostgreSQL server.
 *
 *   npm run test:db                       run every test in tests/postgres
 *   npm run test:db -- tests/postgres/x.test.ts   run the files you name
 *
 * It initialises a brand-new cluster in a temporary directory (trust authentication, listening on
 * 127.0.0.1 only, on a free port), runs the tests with BUGLAB_TEST_DATABASE_URL pointing at it,
 * then stops the server and deletes the directory. Nothing is installed and no existing database
 * is touched.
 *
 * It needs the PostgreSQL server binaries (initdb, pg_ctl): put their directory on PATH, or set
 * PG_BIN to it. On Windows the default install location is searched too.
 *
 * To use a database you already have instead (for example an isolated Neon development branch),
 * set BUGLAB_TEST_DATABASE_URL yourself; no cluster is created. The tests create and drop their
 * own databases named buglab_test_*, so the role needs CREATEDB. NEVER point this at production.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);

function findPgBin() {
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  candidates.push(...(process.env.PATH ?? "").split(delimiter).filter(Boolean));
  if (process.platform === "win32") {
    const root = join(process.env.ProgramFiles ?? "C:\\Program Files", "PostgreSQL");
    if (existsSync(root)) {
      candidates.push(...readdirSync(root).sort((a, b) => Number(b) - Number(a)).map((version) => join(root, version, "bin")));
    }
  }
  return candidates.find((dir) => existsSync(join(dir, exe("initdb"))) && existsSync(join(dir, exe("pg_ctl"))));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function runTests(env, args) {
  const files = args.length > 0 ? args : ["tests/postgres/**/*.test.ts"];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "./tests/setup/register.mjs", "--test", ...files], {
      stdio: "inherit",
      env,
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (process.env.BUGLAB_TEST_DATABASE_URL) {
    process.stdout.write("Using the database named by BUGLAB_TEST_DATABASE_URL (no cluster created).\n");
    process.exitCode = await runTests(process.env, args);
    return;
  }

  const bin = findPgBin();
  if (!bin) {
    process.stderr.write("PostgreSQL server binaries (initdb, pg_ctl) were not found. Put them on PATH or set PG_BIN, or set BUGLAB_TEST_DATABASE_URL.\n");
    process.exitCode = 2;
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "buglab-pg-"));
  const data = join(dir, "data");
  const port = await freePort();
  const pgCtl = join(bin, exe("pg_ctl"));
  let started = false;

  try {
    execFileSync(join(bin, exe("initdb")), ["-D", data, "-U", "buglab_test", "--auth=trust", "--encoding=UTF8", "--locale=C"], { stdio: "ignore" });
    // Durability settings are relaxed on purpose: this server is disposable.
    const options = `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200`;
    execFileSync(pgCtl, ["-D", data, "-o", options, "-l", join(dir, "server.log"), "-w", "-t", "60", "start"], { stdio: "ignore" });
    started = true;
    process.stdout.write(`Throwaway PostgreSQL ${port === 0 ? "" : `listening on 127.0.0.1:${port}`}\n`);

    const env = { ...process.env, BUGLAB_TEST_DATABASE_URL: `postgres://buglab_test@127.0.0.1:${port}/postgres` };
    process.exitCode = await runTests(env, args);
  } finally {
    if (started) spawnSync(pgCtl, ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      process.stderr.write(`Could not remove the temporary cluster at ${dir}; delete it manually.\n`);
    }
  }
}

await main();
