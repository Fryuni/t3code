import { isSshRemoteUrl } from "@t3tools/shared/sourceControl";

import {
  providerAuth,
  type SourceControlAuthProbeInput,
  type SourceControlCliDiscoverySpec,
  type SourceControlUnknownRemoteRefinementInput,
} from "./SourceControlProviderDiscovery.ts";

/** `fj auth list` prints each instance's authority and optional base path, without tokens. */
export function parseForgejoAuthHosts(input: SourceControlAuthProbeInput): ReadonlyArray<string> {
  if (input.exitCode !== 0) return [];
  const hosts = new Set<string>();
  for (const line of input.stdout.split(/\r?\n/u)) {
    const host = line.trim();
    if (!/^(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:]+\])(?::\d+)?(?:\/[^\s?#@\\]*)?$/iu.test(host))
      continue;
    try {
      const url = new URL(`https://${host}`);
      hosts.add(`${url.host}${url.pathname.replace(/\/+$/u, "")}`);
    } catch {
      // A malformed line is not evidence that a host runs Forgejo.
    }
  }
  return [...hosts];
}

function refineUnknownForgejoRemote(input: SourceControlUnknownRemoteRefinementInput) {
  const hosts = parseForgejoAuthHosts(input.auth);
  const remote = new URL(input.context.provider.baseUrl);
  const isGitTransport =
    isSshRemoteUrl(input.context.remoteUrl) || input.context.remoteUrl.startsWith("git://");
  let instance = remote.host.toLowerCase();
  if (!isGitTransport) {
    const url = new URL(input.context.remoteUrl);
    const basePath = url.pathname.split("/").filter(Boolean).slice(0, -2).join("/");
    instance = `${url.host}${basePath ? `/${basePath}` : ""}`;
  }
  let host = hosts.find((candidate) => candidate === instance);
  if (!host && isGitTransport) {
    // Git transports and the web API can listen on different ports. Only infer that mapping
    // when fj knows exactly one web authority for this hostname.
    const matchingHosts = hosts.filter(
      (candidate) => new URL(`https://${candidate}`).hostname === remote.hostname.toLowerCase(),
    );
    if (matchingHosts.length === 1) host = matchingHosts[0];
  }
  if (!host) return null;
  // fj 0.6 saves host names and aliases without a scheme (src/keys.rs and host_name in
  // src/main.rs). Like fj, SSH defaults to HTTPS; HTTP requires an explicit web remote.
  const protocol = input.context.remoteUrl.startsWith("http://") ? "http:" : "https:";
  return { kind: "forgejo", name: "Forgejo", baseUrl: `${protocol}//${host}` } as const;
}

export const discovery = {
  type: "cli",
  kind: "forgejo",
  label: "Forgejo",
  executable: "fj",
  versionArgs: ["version"],
  authArgs: ["auth", "list"],
  parseAuth: (input: SourceControlAuthProbeInput) => {
    const hosts = parseForgejoAuthHosts(input);
    return providerAuth(
      hosts.length > 0
        ? { status: "authenticated", host: hosts.join(", ") }
        : {
            status: input.exitCode === 0 ? "unauthenticated" : "unknown",
            detail: "Run `fj --host <instance> auth login` to authenticate Forgejo CLI.",
          },
    );
  },
  refineUnknownRemote: refineUnknownForgejoRemote,
  installHint:
    "Install Forgejo CLI (`fj`) from https://codeberg.org/forgejo-contrib/forgejo-cli or with `brew install forgejo-cli`.",
} satisfies SourceControlCliDiscoverySpec;
