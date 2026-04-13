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
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
  return dbName;
}

export async function dropProjectDatabase(databaseName: string): Promise<void> {
  const client = new pg.Client(getConnectionConfig());
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
