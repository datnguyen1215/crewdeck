// Orphan cleanup is now handled by MentionHandler's startup recovery.
export async function cleanupOrphans(): Promise<string[]> {
  return [];
}

export async function gracefulShutdown(): Promise<void> {}
