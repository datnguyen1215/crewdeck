export function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function formatCost(cost: number | null): string {
  if (cost === null) return "-";
  return `$${cost.toFixed(4)}`;
}
