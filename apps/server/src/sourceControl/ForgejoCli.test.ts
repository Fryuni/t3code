import { assert, it } from "@effect/vitest";
import { matchForgejoLogin, parseForgejoRemote } from "./ForgejoCli.ts";

it("normalizes URL schemes and surrounding whitespace without folding instance paths", () => {
  for (const value of [
    "https://forge.example:3000/Forge/Owner/Repo.git",
    "  HTTPS://forge.example:3000/Forge/Owner/Repo.git  ",
  ]) {
    assert.deepStrictEqual(parseForgejoRemote(value), {
      host: "forge.example:3000",
      hostname: "forge.example",
      ssh: false,
      path: "Forge/Owner/Repo",
    });
  }
  assert.deepStrictEqual(parseForgejoRemote("  SSH://git@ssh.example:2222/Owner/Repo.git  "), {
    host: "ssh.example:2222",
    hostname: "ssh.example",
    ssh: true,
    path: "Owner/Repo",
  });
});

it("keeps case-distinct mounted instances and SSH ports separate when selecting a login", () => {
  const logins = ["Forge", "forge"].map((path) => ({
    name: path,
    url: `https://forge.example:3000/${path}`,
    user: "alice",
    default: "false",
    ssh_host: path === "Forge" ? "ssh.example:2222" : "ssh.example:3333",
  }));
  assert.strictEqual(
    matchForgejoLogin(
      logins,
      parseForgejoRemote("https://forge.example:3000/Forge/Owner/Repo.git")!,
    )?.name,
    "Forge",
  );
  assert.strictEqual(
    matchForgejoLogin(logins, parseForgejoRemote("ssh://git@ssh.example:3333/Owner/Repo.git")!)
      ?.name,
    "forge",
  );
  assert.isUndefined(
    matchForgejoLogin(
      logins,
      parseForgejoRemote("https://forge.example:4000/Forge/Owner/Repo.git")!,
    ),
  );
});
