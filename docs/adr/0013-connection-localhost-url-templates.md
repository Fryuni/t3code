# ADR 0013: Open a connection's localhost through a URL template

- Status: superseded by upstream
- Date: 2026-10-06
- Tracking: [Fryuni/t3code#54](https://github.com/Fryuni/t3code/pull/54)
- Compared with upstream: `pingdotgg/t3code` at `c77a7b7ee` (2026-10-10)

**Superseded.** Upstream added a preview browser on the environment server
([pingdotgg/t3code#15328](https://github.com/pingdotgg/t3code/pull/15328), `ac8e9453c`).
Server-runtime tabs resolve `localhost` on that machine and stream to remote
clients. Since [pingdotgg/t3code#17316](https://github.com/pingdotgg/t3code/pull/17316)
(`66298aa92`), desktop opens remote environments' tabs locally by default, with
an **Open in the environment's browser** action to move them to the server when
needed. That remains the "another way to reach a remote environment's localhost"
this ADR waited for. The fork dropped `browserLocalhostUrlTemplates`,
the **Localhost previews** dialog, and the resolver changes when it synced onto
upstream `ba0ea3d15`, and keeps upstream's implementation. A template saved
before the sync is an unknown client-settings key and is ignored. The rest of
this record describes the decision as it stood before.

Upstream's preview browser runs only in the desktop app, and
[`browserTargetResolver.ts`](../../apps/web/src/browser/browserTargetResolver.ts)
maps a remote environment's localhost only for agent port previews and detected
servers. It swaps `localhost` for the connection's host when that host is
private-network (LAN, tailnet, `.local`), so the dev server must listen on that
network. An SSH connection's address is a loopback forward on the desktop, so its
ports map onto the desktop's own localhost and each one has to be forwarded by
hand. A public host, which includes T3 Connect, throws "needs the planned
authenticated preview gateway" for agent port previews and leaves detected servers
on the raw address. Explicit URLs (typed, linked, or an agent's `url`) pass through
untouched on purpose: upstream #3939 and #8902 stopped rewriting them because that
broke servers bound to `127.0.0.1`, localhost certificates, and OAuth callbacks. A
user whose remote machine already proxies its ports, through a VPN or a reverse
proxy such as `https://5173.dev.example.com`, has no way to point the preview there.

The fork adds `browserLocalhostUrlTemplates` to
[`ClientSettingsSchema`](../../packages/contracts/src/settings.ts), a record from
environment id to a URL containing `{port}`, edited per saved connection in
**Settings → Connections** on desktop. When a thread's connection has one,
[`localhostUrlTemplate.ts`](../../apps/web/src/browser/localhostUrlTemplate.ts)
turns a localhost URL (`localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`, `::`; ports
default to 80 and 443) into the template's scheme, host, port, and path prefix,
keeping the original path, query, fragment, and credentials. It wins over every
mapping above for that connection, explicit URLs included: the template is the
user saying where that machine's localhost is, which is what #3939 and #8902 could
not know. A URL on the connection's own server origin is never rewritten, because
SSH connections and file previews load from it. Without a template, behavior is
upstream's.

It is client-side rather than advertised by the server, unlike the
[public URL](0010-public-url-for-external-proxies.md). A public URL is a fact
about the deployment, the same for every client. Whether a port proxy is reachable
is a fact about this device's network: a VPN may route only on some devices. A
client setting also works against unmodified and older remote servers, including
upstream's, and needs no server or relay change. The preview browser exists only
in the desktop app, so web and mobile have no use for it; client settings stay per
device, in `client-settings.json` on desktop.

The rewrite happens once, in the renderer, when a URL is opened or navigated to:
the address bar, detected servers, chat, file, and terminal links, and the preview
automation `open` and `navigate` requests. Automation waits for client settings to
hydrate first, since an agent can ask before they load after launch. The
`localhost-template` resolution kind never crosses the wire.

Consequences:

- In-page navigation, redirects, popups, back and forward, and subresource
  requests are not rewritten, so a page that links to its own `localhost` URL
  leaves the proxy.
- The page has to work from the proxy's origin. Dev servers that check the `Host`
  header or allow only localhost origins need configuring on the remote.
- Preview tabs are shared through the server and keep the URL their opener sent.
  A tab opened through a template stores the proxied address, so every desktop
  showing that thread loads it, reachable or not. A tab opened by a client without
  the template keeps the raw localhost address everywhere, this device included.
- History can record the localhost address that was asked for while the page
  loads from the proxy, so titles and favicons of rewritten pages do not attach to
  those entries.

Drop this when upstream ships its authenticated preview gateway or another way to
reach a remote environment's localhost from the desktop preview.
