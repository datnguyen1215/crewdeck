/**
 * Agent orchestration module.
 * Consolidates all agent-related functionality: crew definitions, dispatch parsing,
 * queue management, process spawning, batch tracking, and recovery.
 */

// Crew definitions
export { listCrew, getCrewMember } from "./crew.js";

// Dispatch parsing
export { parseDispatches } from "./parser.js";

// Queue management
export {
  enqueue,
  dequeue,
  getQueuePosition,
  getQueueLength,
  peek,
  isQueued,
  clearQueue,
  clearAllQueues,
  getQueue,
  type QueuedDispatch,
} from "./queue.js";

// Prompt building
export { buildPrompt, type BuildPromptOptions } from "./prompt.js";

// Worktree management
export { createWorktree, cleanupWorktree } from "./worktree.js";

// Shell utilities
export { shellQuote } from "./shell.js";

// Process spawning
export {
  spawnClaude,
  spawnClaudeStream,
  type SpawnOpts,
  type SpawnResult,
  type StreamSpawnResult,
  type ClaudeStreamEvent,
} from "./process.js";

// Process tracking
export {
  activeProcesses,
  getActiveProcessCount,
  hasActiveProcesses,
  hasActiveAgentProcess,
  type ActiveProcess,
} from "./processes.js";

// Batch tracking
export {
  batches,
  issueBatches,
  createBatch,
  handleBatchComplete,
  cleanupStaleBatches,
  markAgentCompleted,
  clearBatches,
  type AgentBatch,
} from "./batch.js";

// Spawner
export { spawnAgent, postSystemComment, processAgentStream } from "./spawner.js";

// Recovery
export { recoverOnStartup, isProcessAlive, killOrphanedProcess, dispatchCaptainsForRecovery } from "./recovery.js";

// Handler (main orchestration)
export { initMentionHandler, shutdownMentionHandler } from "./handler.js";
