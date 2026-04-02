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
