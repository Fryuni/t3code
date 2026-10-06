import type {
  BrowserNavigationTarget,
  EnvironmentId,
  PreviewUrlResolution,
} from "@t3tools/contracts";
import { isLoopbackHost, normalizePreviewUrl } from "@t3tools/shared/preview";
import { isLocalLoopbackHost, isPrivateNetworkHost } from "@t3tools/shared/hostClassification";

import { getClientSettings } from "~/hooks/useSettings";
import { readPreparedConnection } from "~/state/session";

import { applyLocalhostUrlTemplate } from "./localhostUrlTemplate";

export {
  normalizeHostname,
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isPublicFaviconHost,
} from "@t3tools/shared/hostClassification";

const readEnvironmentUrl = (environmentId: EnvironmentId): URL => {
  const connection = readPreparedConnection(environmentId);
  if (!connection) throw new Error(`Environment ${environmentId} is not connected.`);
  return new URL(connection.httpBaseUrl);
};

/**
 * The connection's localhost template applied to `rawUrl`, or null when the
 * connection has none or the URL isn't localhost. A template is the user saying
 * where that machine's localhost is reachable from this device, so it wins
 * over every host mapping below. The environment's own server is left alone:
 * SSH connections reach it through a loopback port on this device, and file
 * previews load from there.
 */
const applyConnectionLocalhostTemplate = (
  environmentId: EnvironmentId,
  rawUrl: string,
): string | null => {
  const template = getClientSettings().browserLocalhostUrlTemplates[environmentId];
  if (template === undefined) return null;
  let url: URL;
  try {
    url = new URL(normalizePreviewUrl(rawUrl));
  } catch {
    // Unparseable input is left for the open path to reject as before.
    return null;
  }
  const connection = readPreparedConnection(environmentId);
  if (connection && new URL(connection.httpBaseUrl).origin === url.origin) return null;
  return applyLocalhostUrlTemplate(template, url)?.href ?? null;
};

const resolveEnvironmentPortTarget = (
  environmentId: EnvironmentId,
  target: Extract<BrowserNavigationTarget, { readonly kind: "environment-port" }>,
  environmentUrl: URL,
  requestedUrl?: string,
  sourceUrl?: URL,
): PreviewUrlResolution => {
  if (!isPrivateNetworkHost(environmentUrl.hostname)) {
    throw new Error(
      "This environment port needs the planned authenticated preview gateway; its server address is not directly private-network reachable.",
    );
  }
  const protocol = target.protocol ?? "http";
  const path = environmentPortPath(target);
  const normalizedEnvironmentHost = environmentUrl.hostname.replace(/^\[|\]$/g, "");
  // Local loopback environments should advertise `localhost` so Chromium
  // dual-stack lookup can reach a Vite server bound only to ::1 or 127.0.0.1.
  const resolvedHost = isLocalLoopbackHost(normalizedEnvironmentHost)
    ? "localhost"
    : normalizedEnvironmentHost.includes(":")
      ? `[${normalizedEnvironmentHost}]`
      : normalizedEnvironmentHost;
  const resolved = sourceUrl
    ? new URL(sourceUrl)
    : new URL(path, `${protocol}://${resolvedHost}:${target.port}`);
  if (sourceUrl) {
    resolved.hostname = resolvedHost;
    resolved.port = String(target.port);
  }
  return {
    requestedUrl: requestedUrl ?? environmentPortRequestedUrl(target),
    resolvedUrl: resolved.toString(),
    resolutionKind: isLocalLoopbackHost(normalizedEnvironmentHost)
      ? "direct"
      : "direct-private-network",
    environmentId,
  };
};

const environmentPortPath = (
  target: Extract<BrowserNavigationTarget, { readonly kind: "environment-port" }>,
): string => (target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`);

const environmentPortRequestedUrl = (
  target: Extract<BrowserNavigationTarget, { readonly kind: "environment-port" }>,
): string =>
  `${target.protocol ?? "http"}://localhost:${target.port}${environmentPortPath(target)}`;

/**
 * Explicit URLs pass through untouched: they name an address reachable from
 * this client, and rewriting them broke servers bound to 127.0.0.1, localhost
 * certificates and OAuth callbacks. A connection with a localhost template is
 * the exception, since its owner has said where that machine's localhost is.
 */
const resolveExplicitUrlTarget = (
  environmentId: EnvironmentId,
  url: string,
): PreviewUrlResolution => {
  const templated = applyConnectionLocalhostTemplate(environmentId, url);
  return {
    requestedUrl: url,
    resolvedUrl: templated ?? url,
    resolutionKind: templated === null ? "direct" : "localhost-template",
    environmentId,
  };
};

export function resolveBrowserNavigationTarget(
  environmentId: EnvironmentId,
  target: BrowserNavigationTarget,
): PreviewUrlResolution {
  if (target.kind === "url") return resolveExplicitUrlTarget(environmentId, target.url);
  const requestedUrl = environmentPortRequestedUrl(target);
  const templated = applyConnectionLocalhostTemplate(environmentId, requestedUrl);
  if (templated !== null) {
    return {
      requestedUrl,
      resolvedUrl: templated,
      resolutionKind: "localhost-template",
      environmentId,
    };
  }
  return resolveEnvironmentPortTarget(environmentId, target, readEnvironmentUrl(environmentId));
}

/**
 * The URL to load for an explicit preview URL (typed, linked, or opened by an
 * agent) in a thread of `environmentId`. Unchanged unless the thread's
 * connection has a localhost template.
 */
export function resolveExplicitPreviewUrl(environmentId: EnvironmentId, url: string): string {
  return resolveExplicitUrlTarget(environmentId, url).resolvedUrl;
}

export function resolveDiscoveredServerUrl(environmentId: EnvironmentId, rawUrl: string): string {
  try {
    const templated = applyConnectionLocalhostTemplate(environmentId, rawUrl);
    if (templated !== null) return templated;
    const normalizedUrl = normalizePreviewUrl(rawUrl);
    const parsed = new URL(normalizedUrl);
    if (!isLoopbackHost(parsed.hostname)) return normalizedUrl;
    return resolveEnvironmentPortTarget(
      environmentId,
      {
        kind: "environment-port",
        port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
        protocol: parsed.protocol === "https:" ? "https" : "http",
        path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      },
      readEnvironmentUrl(environmentId),
      rawUrl,
      parsed,
    ).resolvedUrl;
  } catch {
    return rawUrl;
  }
}
