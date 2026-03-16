/** Captain decision history persistence. */
import { db } from "../index.js";

export interface CaptainHistory {
  id: string;
  project_id: string;
  agent_id: string | null;
  summary: string;
  created_at: string;
}

/** @returns All history entries for a project ordered by creation time. */
export const listCaptainHistory = (projectId: string): CaptainHistory[] =>
  db.prepare("SELECT * FROM CaptainHistory WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as CaptainHistory[];

/** Creates a new captain history entry. */
export const createCaptainHistory = (projectId: string, input: { agent_id?: string; summary: string }): CaptainHistory => {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO CaptainHistory (id, project_id, agent_id, summary) VALUES (?, ?, ?, ?)").run(id, projectId, input.agent_id ?? null, input.summary);
  return db.prepare("SELECT * FROM CaptainHistory WHERE id = ?").get(id) as CaptainHistory;
};
