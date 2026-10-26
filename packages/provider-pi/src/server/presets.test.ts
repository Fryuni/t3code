import { assert, describe, it } from "@effect/vitest";

import { parseOmpModelSelector } from "./presets.ts";

describe("parseOmpModelSelector", () => {
  it("reads a known thinking suffix and keeps slashes in the model id", () => {
    assert.deepEqual(parseOmpModelSelector("loem/z-ai/glm-5.2:high", new Set()), {
      provider: "loem",
      modelId: "z-ai/glm-5.2",
      thinking: "high",
    });
  });

  it("keeps a suffix that is part of an exact model id, as omp does", () => {
    assert.deepEqual(parseOmpModelSelector("openrouter/glm:max", new Set(["openrouter/glm:max"])), {
      provider: "openrouter",
      modelId: "glm:max",
      thinking: undefined,
    });
  });

  it("rejects aliases and bare model names it cannot hand to set_model", () => {
    assert.isNull(parseOmpModelSelector("@slow", new Set()));
    assert.isNull(parseOmpModelSelector("claude-opus:high", new Set()));
  });
});
