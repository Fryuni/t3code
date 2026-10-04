import type { RepositoryIdentity } from "@t3tools/contracts";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";

import { parseForgejoRemote } from "./ForgejoCli.ts";

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

/**
 * The identity of a repository once its remote is known to belong to a Forgejo instance at
 * `baseUrl`, the web origin (and mount path, if any) the matching login is configured with.
 *
 * A git remote is the wrong thing to identify a Forgejo repository by. Its SSH host can be a
 * separate machine, its port is the SSH daemon's, and it never carries the mount path an
 * instance is served below, while two instances can share one hostname on different ports or
 * mounts. So the identity is re-rooted on the instance: the canonical key becomes the web
 * authority plus the repository's path below the web origin, with owner and name folded the
 * way Forgejo folds them and the mount path kept as written, and `webUrl` keeps the scheme,
 * which nothing else records. An HTTP remote already spells the mount path, so it is taken off
 * before the base URL supplies it again.
 *
 * Null when the remote cannot be read; callers keep the identity they had.
 */
export function forgejoRepositoryIdentity(
  identity: RepositoryIdentity,
  baseUrl: string,
): RepositoryIdentity | null {
  const remote = parseForgejoRemote(identity.locator.remoteUrl);
  if (!remote) return null;
  let webUrl: URL;
  try {
    const base = new URL(baseUrl.replace(/\/+$/, ""));
    const basePath = trimSlashes(base.pathname);
    const path =
      !remote.ssh && basePath && remote.path.startsWith(`${basePath}/`)
        ? remote.path.slice(basePath.length + 1)
        : remote.path;
    webUrl = new URL(`${base.href.replace(/\/+$/, "")}/${path}`);
  } catch {
    return null;
  }
  const displayName = trimSlashes(webUrl.pathname);
  return {
    ...identity,
    provider: "forgejo",
    canonicalKey: canonicalRepositoryKey(`${webUrl.host}/${displayName}`, "forgejo"),
    displayName,
    webUrl: webUrl.toString(),
  };
}
