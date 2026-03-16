import { db } from "../index.js";
import type { Agent, AgentWithStatus, Crew, CrewWithAgents, UpdateCrewInput } from "../../types/entities.js";
import { listAgents } from "./agents.js";

export function getCrew(projectId: string): Crew | null {
  return (
    (db.prepare("SELECT * FROM Crew WHERE project_id = ?").get(projectId) as Crew) ?? null
  );
}

interface AgentStatusRow {
  agent_id: string;
  role: string;
  issue_id: string;
  issue_title: string;
}

const agentStatusStmt = `
  SELECT ia.agent_id, ia.role, i.id AS issue_id, i.title AS issue_title
  FROM IssueAgent ia
  JOIN Issue i ON i.id = ia.issue_id
  WHERE ia.agent_id IN (SELECT id FROM Agent WHERE crew_id = ?)
    AND ia.status = 'active'
    AND i.status NOT IN ('done', 'closed', 'cancelled')
  ORDER BY CASE ia.role WHEN 'reviewer' THEN 1 ELSE 0 END
`;

function enrichAgentsWithStatus(crewId: string, agents: Agent[]): AgentWithStatus[] {
  const rows = db.prepare(agentStatusStmt).all(crewId) as AgentStatusRow[];
  const statusMap = new Map<string, AgentStatusRow>();
  for (const row of rows) {
    // First active assignment wins — non-reviewer roles come first via ORDER BY
    if (!statusMap.has(row.agent_id)) statusMap.set(row.agent_id, row);
  }

  return agents.map((agent) => {
    const active = statusMap.get(agent.id);
    if (!active) return { ...agent, status: "idle" as const, current_issue: null };
    const status = active.role === "reviewer" ? "reviewing" as const : "working" as const;
    return { ...agent, status, current_issue: { id: active.issue_id, title: active.issue_title } };
  });
}

export function getCrewWithAgents(projectId: string): CrewWithAgents | null {
  const crew = getCrew(projectId);
  if (!crew) return null;
  return { ...crew, agents: enrichAgentsWithStatus(crew.id, listAgents(crew.id)) };
}

export function updateCrew(projectId: string, input: UpdateCrewInput): Crew {
  db.prepare(
    "UPDATE Crew SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?"
  ).run(input.name, projectId);
  return getCrew(projectId)!;
}
