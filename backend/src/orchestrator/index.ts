import { logger } from "../logger.js";
import { eventBus } from "../events/bus.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { captainSessionName } from "../agent/types.js";
import { JsonlWatcher } from "../agent/jsonl-watcher.js";
import { escapeXml } from "../utils/xml.js";
import {
  getProject,
  updateProject,
  listProjects,
} from "../db/repositories/projects.js";
import { getIssue } from "../db/repositories/issues.js";
import { getAgent, getCaptain } from "../db/repositories/agents.js";
import { getCrewWithAgents } from "../db/repositories/crews.js";
import { listCaptainHistory } from "../db/repositories/captain-history.js";
import {
  createSession,
  getSession,
  updateSession,
  listRunningSessions,
} from "../db/repositories/sessions.js";
import { createCaptainMessage } from "../db/repositories/captain-messages.js";
import { config } from "../config.js";
import { executeAssign, executeSpawnSession } from "./assignment-service.js";
import { executeRouteReview, handleReviewVerdict } from "./review-service.js";
import { executeCreatePR } from "./pr-service.js";

// Build the initial prompt that tells the captain what CLI commands are available
// and provides any saved decision history for context continuity.
function buildCaptainInitialPrompt(
  projectId: string,
  maxConcurrency: number,
): string {
  let prompt = `You are the captain of this project. You drive all decisions using the crewdeck CLI.

## Available Commands

\`\`\`
crewdeck issues list              — list all project issues
crewdeck issues get <issue_id>    — get issue details
crewdeck agents list              — list project agents (with idle/busy status)
crewdeck assign <issue_id> <agent_id>          — assign an agent to work on an issue
crewdeck route-review <issue_id> <agent_id>    — route an issue to a reviewer
crewdeck issues create --title "..." --description "..."  — create a new issue
crewdeck issues update <issue_id> --priority <n>  — update issue priority
crewdeck issues close <issue_id>       — close/cancel an issue
crewdeck activity <issue_id>      — fetch comments and activity for an issue
crewdeck history save --summary "..."  — save a decision summary
crewdeck history list             — list your decision history
crewdeck sessions list            — list project sessions
crewdeck sessions start <agent_id> --issue <issue_id>  — spawn an agent session
crewdeck sessions stop <session_id>  — stop a running session
crewdeck create-pr <issue_id>     — push branch and create a GitHub PR
\`\`\`

## How It Works

1. Events will be sent to you as messages describing what happened (new issue, agent finished, review completed, etc.)
2. Use the CLI commands above to inspect state, assign work, and route reviews.
3. After each decision, save a summary with \`crewdeck history save --summary "..."\`
4. You stay alive across multiple issues — no need to rush.

## Session Lifecycle

You control the full agent session lifecycle:
1. **Assign** the agent to an issue with \`crewdeck assign\`
2. **Spawn** the agent's session with \`crewdeck sessions start <agent_id> --issue <issue_id>\`
3. **Monitor** — the agent works and signals when done
4. **Kill** the session with \`crewdeck sessions stop <session_id>\` when the issue is resolved

## Rules

- Max ${maxConcurrency} issue${maxConcurrency === 1 ? "" : "s"} in progress at a time.
- Only assign idle agents to open/draft issues.
- After assigning, spawn the agent session.
- After an agent finishes, route to a reviewer.
- After review approval, create a PR with \`crewdeck create-pr <issue_id>\`.
- If a review requests changes, re-assign the original worker and spawn a new session.
- Kill agent sessions when issues are marked done.

Start by listing issues and agents to understand the current state.`;

  const history = listCaptainHistory(projectId);
  if (history.length > 0) {
    const entries = history
      .map((h) => `- [${h.created_at}] ${h.summary}`)
      .join("\n");
    prompt += `\n\n## Decision History (from previous sessions)\n${entries}`;
  }

  return prompt;
}

export class OrchestratorManager {
  private readonly captainSessions = new Map<string, string>(); // projectId → sessionId
  private readonly captainSpawning = new Map<string, Promise<string | null>>(); // in-flight spawn guards
  private readonly jsonlWatchers = new Map<string, JsonlWatcher>(); // projectId → watcher
  private readonly claudeSessionIds = new Map<string, string>(); // projectId → claudeSessionId

  constructor(
    private readonly bus: EventBus,
    private readonly adapter: AgentAdapter,
  ) {}

  init(): void {
    // Captain action events — triggered by captain CLI commands via internal API
    this.bus.on("captain.assign", ({ project_id, issue_id, agent_id }) => {
      void executeAssign(
        project_id,
        issue_id,
        agent_id,
        this.bus,
      );
    });

    this.bus.on(
      "captain.route_review",
      ({ project_id, issue_id, reviewer_agent_id }) => {
        void executeRouteReview(
          project_id,
          issue_id,
          reviewer_agent_id,
          this.bus,
          this.adapter,
        );
      },
    );

    this.bus.on("captain.create_pr", ({ project_id, issue_id }) => {
      void executeCreatePR(project_id, issue_id, this.bus);
    });

    this.bus.on("captain.session_start", ({ project_id, agent_id, issue_id }) => {
      void executeSpawnSession(
        project_id,
        issue_id,
        agent_id,
        this.bus,
        this.adapter,
      );
    });

    this.bus.on("session.stop_requested", ({ session_id, project_id }) => {
      void this.handleSessionStop(session_id, project_id);
    });

    // Events that get relayed to the captain via tmux send-keys
    this.bus.on("issue.created", ({ issue }) => {
      if (issue.created_by === "orchestrator") return;
      void this.sendToCaptain(
        issue.project_id,
        `A new issue was created: "${escapeXml(issue.title)}" (ID: ${issue.id}, status: ${issue.status}). Use \`crewdeck issues list\` to see details and decide what to do.`,
      );
    });

    this.bus.on(
      "agent.finished",
      ({ issue_id, project_id, agent_id, role }) => {
        const issue = getIssue(issue_id);
        const agent = getAgent(agent_id);
        void this.sendToCaptain(
          project_id,
          `Agent ${agent?.name ?? agent_id} finished ${role} work on issue "${escapeXml(issue?.title ?? issue_id)}" (issue_id: ${issue_id}). Use \`crewdeck activity ${issue_id}\` to review and decide next steps.`,
        );
      },
    );

    this.bus.on(
      "review.completed",
      ({ issue_id, project_id, agent_id, verdict }) => {
        handleReviewVerdict(issue_id, project_id, agent_id, verdict, this.bus);

        const safeVerdict = ["approved", "changes_requested"].includes(verdict)
          ? verdict
          : "unknown";
        const issue = getIssue(issue_id);
        const agent = getAgent(agent_id);
        void this.sendToCaptain(
          project_id,
          `Review completed on issue "${escapeXml(issue?.title ?? issue_id)}" by ${agent?.name ?? agent_id} with verdict: ${safeVerdict} (round ${issue?.current_review_round ?? "?"}/${issue?.max_review_rounds ?? "?"}).`,
        );
      },
    );

    this.bus.on("issue.approved", ({ issue }) => {
      if (issue.status === "ready") {
        void this.sendToCaptain(
          issue.project_id,
          `All reviewers approved issue "${escapeXml(issue.title)}" (ID: ${issue.id}). Create a PR with \`crewdeck create-pr ${issue.id}\`.`,
        );
      }
    });

    this.bus.on("comment.added", ({ comment, project_id }) => {
      if (comment.author_type !== "user") return;
      void this.sendToCaptain(
        project_id,
        `User posted a comment on issue ${comment.issue_id}: "${escapeXml(comment.content.slice(0, 200))}"`,
      );
    });

    this.bus.on("captain.message", ({ message, project_id }) => {
      if (message.author_type !== "user") return;
      void this.sendToCaptain(
        project_id,
        `User message: ${escapeXml(message.content.slice(0, 500))}`,
      );
    });
  }

  private async handleSessionStop(
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    const session = getSession(sessionId);
    if (!session?.tmux_session_name) return;
    try {
      await this.adapter.kill(session.tmux_session_name);
    } catch {
      /* already gone */
    }
    updateSession(sessionId, { status: "completed" });

    // Clean up captainSessions and watcher if the stopped session is a captain session
    for (const [projId, sessId] of this.captainSessions) {
      if (sessId === sessionId) {
        this.stopWatcher(projId);
        this.captainSessions.delete(projId);
        break;
      }
    }

    logger.info({ sessionId, projectId }, "Session stopped by captain");
  }

  async ensureCaptainSession(projectId: string): Promise<string | null> {
    const existingSessionId = this.captainSessions.get(projectId);
    if (existingSessionId) {
      const tmuxName = captainSessionName(projectId);
      if (await this.adapter.isAlive(tmuxName)) {
        return tmuxName;
      }
      // Session died — clean up and respawn
      this.stopWatcher(projectId);
      this.captainSessions.delete(projectId);
      updateSession(existingSessionId, { status: "completed" });
    }

    // If another call is already spawning, wait for it
    const inflight = this.captainSpawning.get(projectId);
    if (inflight) return inflight;

    const promise = this.spawnCaptainSession(projectId);
    this.captainSpawning.set(projectId, promise);
    try {
      return await promise;
    } finally {
      this.captainSpawning.delete(projectId);
    }
  }

  private async spawnCaptainSession(projectId: string): Promise<string | null> {
    const project = getProject(projectId);
    if (!project) return null;

    const crew = getCrewWithAgents(projectId);
    if (!crew) return null;

    const captain = getCaptain(crew.id);
    if (!captain) {
      logger.info(
        { projectId },
        "Captain: no captain agent designated, skipping",
      );
      return null;
    }

    const tmuxName = captainSessionName(projectId);
    const initialPrompt = buildCaptainInitialPrompt(
      projectId,
      project.max_concurrency,
    );
    const claudeSessionId = crypto.randomUUID();

    const session = createSession({
      project_id: projectId,
      session_type: "captain",
      agent_id: captain.id,
      tmux_session_name: tmuxName,
      status: "running",
      context: {},
    });

    const apiUrl = `http://${config.host}:${config.port}/api/v1`;

    try {
      await this.adapter.spawn({
        sessionName: tmuxName,
        workdir: "/tmp",
        prompt: initialPrompt,
        systemPrompt: captain.system_prompt,
        claudeSessionId,
        env: {
          CREWDECK_PROJECT_ID: projectId,
          CREWDECK_AGENT_ID: captain.id,
          CREWDECK_SESSION_ID: session.id,
          CREWDECK_API_URL: apiUrl,
        },
      });
    } catch (err) {
      logger.error({ err, projectId }, "Captain: failed to spawn session");
      updateSession(session.id, { status: "error" });
      return null;
    }

    this.captainSessions.set(projectId, session.id);
    updateProject(projectId, { orchestrator_session_id: session.id });

    // Start watching the JSONL session file for assistant responses
    this.startWatcher(projectId, claudeSessionId);

    this.bus.emit("session.started", {
      session_id: session.id,
      agent_id: captain.id,
      project_id: projectId,
      tmux_session_name: tmuxName,
    });

    logger.info({ projectId, tmuxName }, "Captain session spawned");
    return tmuxName;
  }

  private async sendToCaptain(
    projectId: string,
    message: string,
  ): Promise<void> {
    const tmuxName = await this.ensureCaptainSession(projectId);
    if (!tmuxName) return;

    // Restart watcher if it auto-stopped while the session is still alive
    const watcher = this.jsonlWatchers.get(projectId);
    const claudeSessionId = this.claudeSessionIds.get(projectId);
    if (claudeSessionId && (!watcher || !watcher.isRunning())) {
      logger.debug(
        { projectId },
        "Restarting JSONL watcher before sending to captain",
      );
      this.startWatcher(projectId, claudeSessionId);
    }

    try {
      await this.adapter.send(tmuxName, message);
      logger.debug(
        { projectId, message: message.slice(0, 100) },
        "Sent message to captain",
      );
    } catch (err) {
      logger.error({ err, projectId }, "Failed to send message to captain");
      this.stopWatcher(projectId);
      const sessionId = this.captainSessions.get(projectId);
      this.captainSessions.delete(projectId);
      if (sessionId) updateSession(sessionId, { status: "error" });
    }
  }

  recoverCaptainSessions(): void {
    const sessions = listRunningSessions();
    let count = 0;
    for (const s of sessions) {
      if (s.session_type === "captain" && s.tmux_session_name) {
        this.captainSessions.set(s.project_id, s.id);
        count++;
      }
    }
    logger.info({ count }, "Recovered captain sessions from DB");
  }

  async startAllCaptains(): Promise<void> {
    const projects = listProjects();
    await Promise.all(
      projects.map((p) =>
        this.ensureCaptainSession(p.id).catch((err) => {
          logger.error(
            { err, projectId: p.id },
            "Failed to auto-start captain session",
          );
        }),
      ),
    );
  }

  notifyOrphanedIssues(issueIds: string[]): void {
    for (const issueId of issueIds) {
      const issue = getIssue(issueId);
      if (!issue || issue.status === "done") continue;
      void this.sendToCaptain(
        issue.project_id,
        `Issue "${escapeXml(issue.title)}" (ID: ${issueId}) was in progress but its agent session died during a backend restart. Use \`crewdeck sessions start <agent_id> --issue ${issueId}\` to respawn the session, or reassign with \`crewdeck assign ${issueId} <agent_id>\`.`,
      );
    }
  }

  async killCaptainSession(projectId: string): Promise<void> {
    this.stopWatcher(projectId);
    const tmuxName = captainSessionName(projectId);
    try {
      await this.adapter.kill(tmuxName);
    } catch {
      /* already gone */
    }
    const sessionId = this.captainSessions.get(projectId);
    if (sessionId) {
      updateSession(sessionId, { status: "completed" });
      this.captainSessions.delete(projectId);
    }
  }

  private startWatcher(projectId: string, claudeSessionId: string): void {
    // Snapshot byte offset from old watcher so the new one resumes where it left off
    const oldWatcher = this.jsonlWatchers.get(projectId);
    const resumeOffset = oldWatcher ? oldWatcher.getOffset() : 0;
    this.stopWatcher(projectId);
    this.claudeSessionIds.set(projectId, claudeSessionId);
    const tmuxName = captainSessionName(projectId);
    const watcher = new JsonlWatcher(
      claudeSessionId,
      "/tmp",
      (text) => {
        const message = createCaptainMessage(projectId, {
          author_type: "captain",
          content: text,
        });
        this.bus.emit("captain.message", { message, project_id: projectId });
      },
      () => this.adapter.isAlive(tmuxName),
      resumeOffset,
    );
    watcher.start();
    this.jsonlWatchers.set(projectId, watcher);
  }

  private stopWatcher(projectId: string): void {
    const watcher = this.jsonlWatchers.get(projectId);
    if (watcher) {
      watcher.stop();
      this.jsonlWatchers.delete(projectId);
    }
    this.claudeSessionIds.delete(projectId);
  }
}

export function initOrchestrator(adapter: AgentAdapter): OrchestratorManager {
  const manager = new OrchestratorManager(eventBus, adapter);
  manager.init();
  return manager;
}
