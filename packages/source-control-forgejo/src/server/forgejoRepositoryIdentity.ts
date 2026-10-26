import { SourceControlProviderKind, type RepositoryIdentity } from "@t3tools/contracts";
import { foldRepositoryKey } from "@t3tools/shared/sourceControl";

import { parseForgejoRemote } from "./ForgejoCli.ts";

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

/**
 * Re-roots a remote's identity on the Forgejo instance at `baseUrl`: an SSH host, port and missing
 * mount cannot tell instances apart. The key is the web authority plus the path below it, owner and
 * name folded and the mount kept as written; `webUrl` keeps the scheme. Null if the remote is unreadable.
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
    provider: SourceControlProviderKind.make("forgejo"),
    canonicalKey: foldRepositoryKey(`${webUrl.host}/${displayName}`, "forgejo"),
    displayName,
    webUrl: webUrl.toString(),
  };
}
