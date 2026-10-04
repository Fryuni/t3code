import { assert, it } from "@effect/vitest";

import { resolveWorktreeStartRemote, type WorktreeStartRemote } from "./vcs.ts";

it.each([
  { input: {}, expected: null },
  { input: { startFromOrigin: true }, expected: "origin" },
  { input: { startFromOrigin: false }, expected: null },
  { input: { startFromRemote: "origin", startFromOrigin: true }, expected: "origin" },
  { input: { startFromRemote: "upstream", startFromOrigin: false }, expected: "upstream" },
  { input: { startFromRemote: "upstream", startFromOrigin: true }, expected: "upstream" },
  { input: { startFromRemote: null, startFromOrigin: false }, expected: null },
  { input: { startFromRemote: null, startFromOrigin: true }, expected: null },
] satisfies ReadonlyArray<{
  input: { startFromRemote?: WorktreeStartRemote; startFromOrigin?: boolean };
  expected: WorktreeStartRemote;
}>)("resolves persisted and wire remote selections: $input", ({ input, expected }) => {
  assert.equal(resolveWorktreeStartRemote(input), expected);
});
