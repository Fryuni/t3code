const SCP_SSH_REMOTE_PATTERN = /^[a-zA-Z0-9._-]+@([^:/]+):/;

export function isSshRemoteUrl(remoteUrl: string): boolean {
  const trimmed = remoteUrl.trim();
  return SCP_SSH_REMOTE_PATTERN.test(trimmed) || trimmed.toLowerCase().startsWith("ssh://");
}

/**
 * A repository path folded the way its host folds it. Forgejo folds owner and name only: a mount
 * path (`https://example.com/Forge`) belongs to the proxy, where case can tell instances apart.
 * Without a kind, or one that may still be Forgejo, only the last two segments fold.
 */
export function normalizeSourceControlRepository(repository: string, kind?: string | null): string {
  if (kind != null && kind !== "unknown" && kind !== "forgejo")
    return repository.trim().toLowerCase();
  const segments = repository.trim().split("/");
  return segments
    .map((segment, index) => (index >= segments.length - 2 ? segment.toLowerCase() : segment))
    .join("/");
}

/** The comparison form of a `host/repository` key: host folded, the path per its host's fold. */
export function foldRepositoryKey(key: string, kind?: string | null): string {
  const separator = key.indexOf("/");
  if (separator < 0) return key.toLowerCase();
  return `${key.slice(0, separator).toLowerCase()}/${normalizeSourceControlRepository(key.slice(separator + 1), kind)}`;
}
