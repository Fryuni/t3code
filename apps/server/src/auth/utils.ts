import type {
  AuthClientMetadata,
  AuthClientMetadataDeviceType,
  AuthClientPresentationMetadata,
} from "@t3tools/contracts";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as NodeCrypto from "node:crypto";
import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";

const SESSION_COOKIE_NAME = "t3_session";

/**
 * Cookies are scoped by host but *not* by port, so any two servers that can be
 * live on one hostname at once need separate names — otherwise the second
 * clobbers the first's session and both sides see "Invalid session token
 * signature" until someone clears cookies by hand.
 *
 * Remote web servers use their persisted environment identity and omit the
 * port, so the name survives state-directory moves and public port changes.
 * A loopback listener advertised through `--public-url` counts as remote: the
 * proxy origin is the only host browsers see, and the internal port behind it
 * can move on any restart.
 *
 * Desktop scans upward from 3773 for a free port and binds
 *   127.0.0.1, so a second instance lands on a different port and the same host.
 *   A desktop backend behind a proxy follows the remote rule instead.
 */
export function resolveSessionCookieName(input: {
  readonly mode: "web" | "desktop";
  readonly port: number;
  readonly host: string | undefined;
  readonly publicUrl: URL | undefined;
  readonly instanceKey: string;
  readonly environmentId: string;
  readonly development: boolean;
}): string {
  const remoteReachable = !input.development && isRemoteReachableServer(input);

  // Desktop keys on the port because two local instances share 127.0.0.1, but a
  // proxied desktop backend has the web server's problem instead: the proxy
  // origin outlives the port that DesktopApp's upward scan happened to pick.
  // Its environment identity separates local instances just as well, so only
  // this new combination leaves the port scheme.
  const proxiedDesktop =
    input.mode === "desktop" &&
    remoteReachable &&
    input.publicUrl !== undefined &&
    isRemoteReachableHost(input.publicUrl.hostname);

  if (input.mode === "desktop" && !proxiedDesktop) {
    return `${SESSION_COOKIE_NAME}_${input.port}`;
  }
  const instanceHash = NodeCrypto.createHash("sha256")
    .update(remoteReachable ? input.environmentId : input.instanceKey)
    .digest("hex")
    .slice(0, 12);

  if (remoteReachable) {
    return `${SESSION_COOKIE_NAME}_${instanceHash}`;
  }

  // Cookies are scoped by host, not port. Loopback development servers need an
  // instance-specific name or parallel agents overwrite each other's session,
  // and a server that later reuses the port receives a token signed elsewhere.
  return `${SESSION_COOKIE_NAME}_${input.port}_${instanceHash}`;
}

export function resolveLegacySessionCookieName(input: {
  readonly mode: "web" | "desktop";
  readonly host: string | undefined;
  readonly publicUrl: URL | undefined;
  readonly development: boolean;
}): string | undefined {
  return input.mode === "web" && !input.development && isRemoteReachableServer(input)
    ? SESSION_COOKIE_NAME
    : undefined;
}

export function isRemoteReachableHost(host: string | undefined): boolean {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return true;
  }
  if (!host || host.length === 0) {
    return false;
  }
  return !(
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  );
}

/**
 * A server is reachable from other machines when it binds a non-loopback
 * interface *or* advertises an external origin that some other process routes
 * to it. Callers that only look at the bind address misclassify a loopback
 * listener sitting behind a reverse proxy.
 */
export function isRemoteReachableServer(input: {
  readonly host: string | undefined;
  readonly publicUrl: URL | undefined;
}): boolean {
  return (
    isRemoteReachableHost(input.host) ||
    (input.publicUrl !== undefined && isRemoteReachableHost(input.publicUrl.hostname))
  );
}

export function base64UrlEncode(input: string | Uint8Array): string {
  return typeof input === "string"
    ? Encoding.encodeBase64Url(new TextEncoder().encode(input))
    : Encoding.encodeBase64Url(input);
}

export function base64UrlDecodeUtf8(input: string): string {
  return Result.getOrThrow(Encoding.decodeBase64UrlString(input));
}

export function signPayload(payload: string, secret: Uint8Array): string {
  return NodeCrypto.createHmac("sha256", Buffer.from(secret)).update(payload).digest("base64url");
}

export function timingSafeEqualBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return NodeCrypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIpAddress(value: string | null | undefined): string | undefined {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
}

function inferDeviceType(userAgent: string | undefined): AuthClientMetadataDeviceType {
  if (!userAgent) {
    return "unknown";
  }

  const normalized = userAgent.toLowerCase();
  if (/bot|crawler|spider|slurp|curl|wget/.test(normalized)) {
    return "bot";
  }
  if (/ipad|tablet/.test(normalized)) {
    return "tablet";
  }
  if (/iphone|android.+mobile|mobile/.test(normalized)) {
    return "mobile";
  }
  return "desktop";
}

function inferBrowser(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  const normalized = userAgent.toLowerCase();
  if (/edg\//.test(normalized)) return "Edge";
  if (/opr\//.test(normalized)) return "Opera";
  if (/firefox\//.test(normalized)) return "Firefox";
  if (/electron\//.test(normalized)) return "Electron";
  if (/chrome\//.test(normalized) || /crios\//.test(normalized)) return "Chrome";
  if (/safari\//.test(normalized) && !/chrome\//.test(normalized)) return "Safari";
  return undefined;
}

function inferOs(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  const normalized = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(normalized)) return "iOS";
  if (/android/.test(normalized)) return "Android";
  if (/mac os x|macintosh/.test(normalized)) return "macOS";
  if (/windows nt/.test(normalized)) return "Windows";
  if (/linux/.test(normalized)) return "Linux";
  return undefined;
}

function readRemoteAddressFromSource(source: unknown): string | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const candidate = source as {
    readonly remoteAddress?: string | null;
    readonly socket?: {
      readonly remoteAddress?: string | null;
    };
  };

  return normalizeIpAddress(candidate.socket?.remoteAddress ?? candidate.remoteAddress);
}

export function deriveAuthClientMetadata(input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly presented?: AuthClientPresentationMetadata;
}): AuthClientMetadata {
  const userAgent = normalizeNonEmptyString(input.request.headers["user-agent"]);
  const ipAddress = readRemoteAddressFromSource(input.request.source);
  const os = input.presented?.os ?? inferOs(userAgent);
  const browser = inferBrowser(userAgent);
  return {
    ...(input.presented?.label ? { label: input.presented.label } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
    deviceType: input.presented?.deviceType ?? inferDeviceType(userAgent),
    ...(os ? { os } : {}),
    ...(browser ? { browser } : {}),
  };
}
