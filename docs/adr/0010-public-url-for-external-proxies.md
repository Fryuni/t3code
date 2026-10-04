# ADR 0010: Declare a public URL for servers behind an external proxy

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#7](https://github.com/Fryuni/t3code/pull/7)
- Compared with upstream: `pingdotgg/t3code` at `dab26f582` (2026-10-03), after Orchestrator V2

Upstream works out whether a server is reachable from other machines by looking
only at the address it binds. Its remote routes are binding a LAN or tailnet
interface, Tailscale Serve (which the server configures itself), desktop network
access, and the T3 Connect relay. A user who runs their own proxy or tunnel
(nginx, Caddy, Traefik, Cloudflare Tunnel, an ingress) to handle TLS and routing,
while the server stays on `127.0.0.1`, gets loopback URLs in every startup link,
QR code, and `t3 pair` output, plus a hint to restart with a reachable `--host`,
which pushes them to expose the raw port. On desktop with network access off,
Settings shows no pairing links at all. `T3CODE_DESKTOP_HTTPS_ENDPOINTS` is the
closest upstream setting, but it only adds desktop endpoints: it does not change
auth policy, cookie names, headless output, or `t3 pair`, it labels every endpoint
public, and Settings hides it while network access is off.

The fork adds `--public-url` and `T3CODE_PUBLIC_URL` (the flag wins) on `t3`,
`t3 serve`, and `t3 start`. The value is an origin the operator declares; it does
not change the bind address. When it is set:

- Every place that advertises the server uses it: the headless startup output and
  QR code, the web-mode startup pairing link, `server-runtime.json` and therefore a
  later `t3 pair`, `server.getConfig`, and the default endpoint in **Settings →
  Connections**. `t3 pair --tailscale` still wins. Local CLI calls such as
  `t3 project` keep talking to the recorded loopback `origin`.
- Auth treats a non-loopback public URL as remote-reachable
  ([`isRemoteReachableServer`](../../apps/server/src/auth/utils.ts)), so web
  servers report `remote-reachable` and desktop servers add one-time-token pairing.
- Session cookie names use the environment identity (`t3_session_<hash>`) instead
  of the port, for web servers and for desktop servers whose public URL is
  non-loopback.

It accepts only an HTTP(S) origin with no credentials, path, query, or fragment.
The web app, `/ws`, `/api`, `/oauth`, and `/.well-known` are all mounted at the
root, so serving T3 Code under a sub-path is out of scope.

The server does not check that the URL is reachable. A typo advertises a dead
address and still switches auth to remote-reachable, the same failure mode as
`T3CODE_DESKTOP_HTTPS_ENDPOINTS`. Changing it takes a restart, and removing the flag
or variable returns to upstream's address selection.

Cookie names matter for proxies that follow the port. Web mode picks a free port
and desktop scans upward from 3773, so a restart can land on another port. A proxy
pinned to one upstream port breaks then anyway, and a server started with a fixed
`--port` already had a stable name. The identity-keyed name helps proxies that
follow the port, such as the Tailscale Serve mapping `t3 pair --tailscale` repairs
or a proxy driven by `server-runtime.json`. Names change once when the URL is first
set, so browsers paired before may have to pair again. Network-exposed desktop
servers (`0.0.0.0`) without a public URL keep `t3_session_<port>`, because renaming
it would sign out their existing clients. Proxied web servers also keep accepting
the bare legacy `t3_session` cookie, as remote web servers do, so a user who ran
`--host 0.0.0.0` behind the same proxy before upstream's per-instance names is not
signed out by moving to loopback plus `--public-url`.

[`withPublicUrlEndpoint`](../../apps/web/src/components/settings/pairingUrls.ts)
builds the Settings endpoint with the shared `createAdvertisedEndpoint`. Its
reachability label is a guess from the host name, using the shared
`hostClassification` helpers: loopback (including any `127.` name, the same rule
the server's auth check uses), tailnet (`100.64.0.0/10`, `*.ts.net`) as
private-network, private addresses, `.local`, `.home.arpa`, and single-label names
as LAN, and anything else as public. A split-horizon name that only resolves inside
a network is labelled public; the label only changes the share hint. app.t3.codes
can use the endpoint only when the URL is `https`. On desktop it also enables the
pairing-link section and endpoint description while network access is off. In web
mode it becomes the default for copied pairing links and the QR code wherever the
browser is, including the public origin itself; the current-origin link is only the
fallback when no public URL is set. An `https` URL therefore yields an app.t3.codes
link carrying the server as `host`, as Tailscale HTTPS endpoints do, and an `http`
URL yields `<public URL>/pair`.

On desktop the URL belongs to the primary environment only. A Windows, macOS, or
Linux primary inherits `T3CODE_PUBLIC_URL` from the app's environment. A WSL primary
gets it as an explicit `--public-url` argument, because WSLENV does not reliably
translate URLs. The secondary WSL backend has the variable removed and gets no
argument, so two backends never claim one proxy origin. A desktop app launched from
the dock, Start menu, or a launcher does not read shell profiles (the login-shell
import only copies a fixed list such as `PATH`), so the variable must be set at the
OS level or the app started from a terminal.

There is no settings UI or desktop IPC for it. The public URL is a fact about the
deployment, owned by whoever runs the proxy, so it is configured where the server
starts, in line with the "Change network exposure where the server starts" copy.
Mobile only consumes pairing URLs and needs no change. The T3 Connect relay is
unaffected: `publicUrl` is part of server config, which clients read over the
WebSocket, not of the environment descriptor the relay serves.
[`scripts/dev-runner.ts`](../../scripts/dev-runner.ts) removes `T3CODE_PUBLIC_URL`
along with the service-launcher variables, because agents run with the server's
environment, and a dev server started inside a public-URL server would otherwise
advertise the parent's origin and use its cookie naming.

The fork's original group also added `t3 wake`, a shared running-server lookup
(`cli/runningServer.ts`), and `T3CODE_THREAD_ID`. The maintainer decided they are no
longer needed, so they were not ported; `t3 pair` keeps upstream's own lookup and
only reads the new `publicUrl` field.

Drop this when upstream lets a server declare a public origin that differs from its
bind address.
