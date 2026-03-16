import { ChildProcess, spawn } from "child_process";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createServer } from "net";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { GlobalSetupContext } from "vitest/node";
import Database from "better-sqlite3";

const BACKEND_DIR = resolve(__dirname, "../../../backend");
const BACKEND_ENTRY = join(BACKEND_DIR, "dist/index.js");
const SCHEMA_PATH = join(BACKEND_DIR, "src/db/schema.sql");

let backendProcess: ChildProcess;
let tmpDir: string;

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForReady(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Backend did not become ready within ${timeoutMs}ms`);
}

function seedDatabase(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);

  const projectId = randomUUID();
  const crewId = randomUUID();
  const agentId = randomUUID();
  const issueId = randomUUID();
  const sessionId = randomUUID();

  db.prepare("INSERT INTO Project (id, name, description) VALUES (?, ?, ?)").run(
    projectId, "test-project", "integration test",
  );
  db.prepare("INSERT INTO Crew (id, project_id, name) VALUES (?, ?, ?)").run(
    crewId, projectId, "test-crew",
  );
  db.prepare("INSERT INTO Agent (id, crew_id, name, title, system_prompt) VALUES (?, ?, ?, ?, ?)").run(
    agentId, crewId, "test-agent", "worker", "test",
  );
  db.prepare("INSERT INTO Issue (id, project_id, title, description) VALUES (?, ?, ?, ?)").run(
    issueId, projectId, "test issue", "integration test",
  );
  db.prepare("INSERT INTO Session (id, project_id, session_type, agent_id, issue_id) VALUES (?, ?, ?, ?, ?)").run(
    sessionId, projectId, "agent", agentId, issueId,
  );

  db.close();

  return { projectId, crewId, agentId, issueId, sessionId };
}

export default async function setup({ provide }: GlobalSetupContext) {
  tmpDir = mkdtempSync(join(tmpdir(), "crewdeck-cli-integration-"));
  const dbPath = join(tmpDir, "test.db");

  const seeded = seedDatabase(dbPath);

  const port = await findFreePort();
  const baseUrl = `http://localhost:${port}`;

  backendProcess = spawn("node", [BACKEND_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "localhost",
      DB_PATH: dbPath,
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendProcess.stderr?.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) console.error(`[backend stderr] ${msg}`);
  });

  function teardown() {
    if (backendProcess) backendProcess.kill("SIGTERM");
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }

  try {
    await waitForReady(baseUrl);
  } catch (err) {
    teardown();
    throw err;
  }

  provide("baseUrl", baseUrl);
  provide("dbPath", dbPath);
  provide("seeded", seeded);

  return teardown;
}

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
    dbPath: string;
    seeded: {
      projectId: string;
      crewId: string;
      agentId: string;
      issueId: string;
      sessionId: string;
    };
  }
}
