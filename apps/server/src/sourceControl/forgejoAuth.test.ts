import { assert, it } from "@effect/vitest";
import { detectSourceControlProviderFromRemoteUrl } from "@t3tools/shared/sourceControl";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import { discovery, parseForgejoAuthHosts } from "./forgejoAuth.ts";

const auth = (stdout: string, code = 0, stderr = "") => ({
  stdout,
  stderr,
  exitCode: ChildProcessSpawner.ExitCode(code),
});

const refine = (remoteUrl: string, stdout: string, code = 0) =>
  discovery.refineUnknownRemote({
    cwd: "/repo",
    context: {
      remoteName: "origin",
      remoteUrl,
      provider: detectSourceControlProviderFromRemoteUrl(remoteUrl)!,
    },
    auth: auth(stdout, code),
  });

it("recognizes every authenticated instance without hostname heuristics", () => {
  for (const host of ["codeberg.org", "git.example.test", "git.gay"]) {
    assert.deepStrictEqual(
      refine(`git@${host}:owner/repo.git`, "codeberg.org\ngit.example.test\ngit.gay\n"),
      {
        kind: "forgejo",
        name: "Forgejo",
        baseUrl: `https://${host}`,
      },
    );
  }
});

it("keeps ports and HTTP origins distinct, and maps an unambiguous SSH host", () => {
  assert.deepStrictEqual(
    refine(
      "http://git.example.test:3000/owner/repo.git",
      "git.example.test:3000\ngit.example.test:4000",
    ),
    {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "http://git.example.test:3000",
    },
  );
  assert.strictEqual(
    refine(
      "https://git.example.test:5000/owner/repo",
      "git.example.test:3000\ngit.example.test:4000",
    ),
    null,
  );
  assert.strictEqual(
    refine(
      "ssh://git@git.example.test:2222/owner/repo",
      "git.example.test:3000\ngit.example.test:4000",
    ),
    null,
  );
  assert.deepStrictEqual(
    refine("ssh://git@git.example.test:2222/owner/repo", "git.example.test:3000"),
    {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.test:3000",
    },
  );
});

it("preserves instance paths and distinguishes instances on the same authority", () => {
  const hosts = "GIT.EXAMPLE.TEST:3000/Forge\ngit.example.test:3000/other";
  assert.deepStrictEqual(parseForgejoAuthHosts(auth(hosts)), [
    "git.example.test:3000/Forge",
    "git.example.test:3000/other",
  ]);
  assert.deepStrictEqual(refine("http://git.example.test:3000/Forge/owner/repo.git", hosts), {
    kind: "forgejo",
    name: "Forgejo",
    baseUrl: "http://git.example.test:3000/Forge",
  });
  assert.isNull(refine("https://git.example.test:3000/forge/owner/repo.git", hosts));
  assert.isNull(refine("https://git.example.test:3000/owner/repo.git", hosts));
  assert.isNull(refine("ssh://git@git.example.test:2222/owner/repo.git", hosts));
  assert.deepStrictEqual(
    refine("ssh://git@git.example.test:2222/owner/repo.git", hosts.split("\n")[0]!),
    {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.test:3000/Forge",
    },
  );
});

it("does not classify unauthenticated hosts or trust failed probes and stderr", () => {
  assert.strictEqual(refine("https://other.example.test/owner/repo", "git.example.test"), null);
  assert.strictEqual(refine("https://git.example.test/owner/repo", "git.example.test", 1), null);
  assert.deepStrictEqual(parseForgejoAuthHosts(auth("", 0, "git.example.test")), []);
  assert.deepStrictEqual(
    parseForgejoAuthHosts(
      auth(
        "  GIT.EXAMPLE.TEST:8443\r\ngit.example.test:8443\nerror: not logged in\nhttps://user:secret@git.other.test\n",
      ),
    ),
    ["git.example.test:8443"],
  );
});

it("reports all configured hosts and provides login guidance for an empty list", () => {
  const authenticated = discovery.parseAuth(auth("codeberg.org\ngit.example.test"));
  assert.strictEqual(authenticated.status, "authenticated");
  assert.deepStrictEqual(authenticated.host, Option.some("codeberg.org, git.example.test"));
  assert.strictEqual(discovery.parseAuth(auth("")).status, "unauthenticated");
  assert.strictEqual(discovery.parseAuth(auth("", 1)).status, "unknown");
});
