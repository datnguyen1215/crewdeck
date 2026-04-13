import pg from "pg";
import { config } from "../config.js";

function getConnectionConfig() {
  return {
    host: config.postgresHost,
    port: config.postgresPort,
    user: config.postgresUser,
    password: config.postgresPassword,
  };
}

function sanitizeProjectId(projectId: string): string {
  return projectId.replace(/-/g, "_");
}

export async function createProjectDatabase(projectId: string): Promise<string> {
  const dbName = `project_${sanitizeProjectId(projectId)}`;
  const client = new pg.Client(getConnectionConfig());
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
  return dbName;
}

const VALID_DB_NAME = /^project_[a-f0-9_]+$/;

export async function dropProjectDatabase(databaseName: string): Promise<void> {
  if (!VALID_DB_NAME.test(databaseName)) {
    throw new Error(`Invalid database name: ${databaseName}`);
  }
  const client = new pg.Client(getConnectionConfig());
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
