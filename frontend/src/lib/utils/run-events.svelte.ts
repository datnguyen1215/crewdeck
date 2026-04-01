import { untrack } from "svelte";
import type { AgentRun, AgentRunEvent } from "$lib/api/http.js";
import type { WsEventMap } from "$lib/api/types.js";

/**
 * Returns WebSocket event handlers for run.started, run.event, run.completed.
 * Uses getter/setter functions to always access the current reactive state.
 */
export function createRunEventHandlers(
  issueId: string,
  projectId: string,
  getRuns: () => AgentRun[],
  setRuns: (runs: AgentRun[]) => void,
  getLiveEvents: () => Map<string, AgentRunEvent[]>,
  setLiveEvents: (map: Map<string, AgentRunEvent[]>) => void,
) {
  const handleRunStarted = (data: WsEventMap["run.started"]) => {
    if (data.issue_id !== issueId) return;
    const newRun: AgentRun = {
      id: data.agent_run_id,
      project_id: projectId,
      issue_id: issueId,
      agent_id: data.agent_id,
      pid: null,
      status: data.status,
      exit_code: null,
      cost_usd: null,
      duration_ms: null,
      started_at: data.started_at,
      completed_at: null,
      created_at: new Date().toISOString(),
    };
    setRuns([newRun, ...getRuns()]);
    const map = getLiveEvents();
    map.set(newRun.id, []);
    setLiveEvents(new Map(map));
  };

  const handleRunEvent = (data: WsEventMap["run.event"]) => {
    const runId = data.agent_run_id;
    const run = getRuns().find((r) => r.id === runId);
    if (!run || run.issue_id !== issueId) return;
    const event: AgentRunEvent = {
      id: data.event_id,
      agent_run_id: runId,
      type: data.type,
      data: data.data,
      created_at: data.created_at,
    };
    const map = getLiveEvents();
    const existing = map.get(runId) ?? [];
    map.set(runId, [...existing, event]);
    setLiveEvents(new Map(map));
  };

  const handleRunCompleted = (data: WsEventMap["run.completed"]) => {
    const runId = data.agent_run_id;
    setRuns(
      getRuns().map((r) => {
        if (r.id !== runId) return r;
        return {
          ...r,
          status: data.status,
          exit_code: data.exit_code,
          cost_usd: data.cost_usd,
          duration_ms: data.duration_ms,
          completed_at: data.completed_at,
        };
      }),
    );
  };

  return { handleRunStarted, handleRunEvent, handleRunCompleted };
}

/**
 * Merges API-fetched events with buffered live events, deduplicating by ID.
 */
export function mergeWithLiveEvents(
  apiEvents: AgentRunEvent[],
  liveEvents: Map<string, AgentRunEvent[]>,
  runId: string,
): AgentRunEvent[] {
  const live = liveEvents.get(runId) ?? [];
  const apiEventIds = new Set(apiEvents.map((e) => e.id));
  const newLiveEvents = live.filter((e) => !apiEventIds.has(e.id));
  return [...apiEvents, ...newLiveEvents];
}

/**
 * Returns a function suitable for use in $effect() that incrementally appends
 * new live events using untrack() to avoid reactive loops.
 */
export function createLiveEventSync(
  getLiveEvents: () => Map<string, AgentRunEvent[]>,
  getRunId: () => string | null,
  getEvents: () => AgentRunEvent[],
  setEvents: (events: AgentRunEvent[]) => void,
) {
  return () => {
    const runId = getRunId();
    if (!runId) return;
    const live = getLiveEvents().get(runId) ?? [];
    if (live.length === 0) return;
    const existingIds = new Set(untrack(getEvents).map((e) => e.id));
    const newEvents = live.filter((e) => !existingIds.has(e.id));
    if (newEvents.length > 0) {
      setEvents([...untrack(getEvents), ...newEvents]);
    }
  };
}
