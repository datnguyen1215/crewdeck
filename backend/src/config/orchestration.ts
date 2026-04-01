// Orchestration timing constants — all tunable via environment variables.

// Timeouts
export const BATCH_TIMEOUT_MS =
  Number(process.env.ORCHESTRATION_BATCH_TIMEOUT_MS) || 30 * 60 * 1000;

export const PTY_IDLE_TIMEOUT_MS =
  Number(process.env.ORCHESTRATION_PTY_IDLE_TIMEOUT_MS) || 30 * 60 * 1000;

export const PROCESS_GRACE_PERIOD_MS =
  Number(process.env.ORCHESTRATION_PROCESS_GRACE_PERIOD_MS) || 5000;

export const DEFAULT_AGENT_TIMEOUT_MINUTES =
  Number(process.env.ORCHESTRATION_DEFAULT_AGENT_TIMEOUT_MINUTES) || 10;

// Intervals
export const BATCH_CLEANUP_INTERVAL_MS =
  Number(process.env.ORCHESTRATION_BATCH_CLEANUP_INTERVAL_MS) || 5 * 60 * 1000;

export const PR_POLL_INTERVAL_MS =
  Number(process.env.ORCHESTRATION_PR_POLL_INTERVAL_MS) || 60 * 1000;

export const EVENT_BATCHING_WINDOW_MS =
  Number(process.env.ORCHESTRATION_EVENT_BATCHING_WINDOW_MS) || 5000;

// Delays
export const SERVER_RECOVERY_DELAY_MS =
  Number(process.env.ORCHESTRATION_SERVER_RECOVERY_DELAY_MS) || 2000;

export const STARTUP_BUFFER_MS =
  Number(process.env.ORCHESTRATION_STARTUP_BUFFER_MS) || 500;

// Limits
export const MAX_CONTEXT_MESSAGES =
  Number(process.env.ORCHESTRATION_MAX_CONTEXT_MESSAGES) || 10;
