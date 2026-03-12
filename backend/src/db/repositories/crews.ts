import { db } from "../index.js";
import type { Crew, CrewWithAgents, UpdateCrewInput } from "../../types/entities.js";
import { listAgents } from "./agents.js";

export function getCrew(projectId: string): Crew | null {
  return (
    (db.prepare("SELECT * FROM Crew WHERE project_id = ?").get(projectId) as Crew) ?? null
  );
}

export function getCrewWithAgents(projectId: string): CrewWithAgents | null {
  const crew = getCrew(projectId);
  if (!crew) return null;
  return { ...crew, agents: listAgents(crew.id) };
}

export function updateCrew(projectId: string, input: UpdateCrewInput): Crew {
  db.prepare(
    "UPDATE Crew SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?"
  ).run(input.name, projectId);
  return getCrew(projectId)!;
}
