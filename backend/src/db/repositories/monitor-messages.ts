import { db } from "../index.js";
import type {
  MonitorMessage,
  MonitorMessageRole,
} from "../../types/entities.js";

interface MonitorMessageRow {
  id: string;
  project_id: string;
  role: MonitorMessageRole;
  content: string;
  created_at: string;
}

export function create(
  projectId: string,
  role: MonitorMessageRole,
  content: string,
): MonitorMessage {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO MonitorMessage (id, project_id, role, content) VALUES (?, ?, ?, ?)`,
  ).run(id, projectId, role, content);
  const row = db
    .prepare("SELECT * FROM MonitorMessage WHERE id = ?")
    .get(id) as MonitorMessageRow;
  return row;
}

export function getByProject(projectId: string, limit = 100): MonitorMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM MonitorMessage WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as MonitorMessageRow[];
  return rows;
}

export function getAllProjects(limitPerProject = 20): MonitorMessage[] {
  const rows = db
    .prepare(
      `SELECT id, project_id, role, content, created_at
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) AS rn
         FROM MonitorMessage
       )
       WHERE rn <= ?
       ORDER BY project_id, created_at DESC`,
    )
    .all(limitPerProject) as MonitorMessageRow[];
  return rows;
}
