import { describe, expect, it } from "@effect/vitest";
import {
  ohMyPiWorkspaceCatalog,
  prepareOhMyPiPrompt,
  splitOhMyPiAvailableCommands,
} from "./OhMyPiSkillDispatch.ts";

const catalog = ohMyPiWorkspaceCatalog({
  slashCommands: [{ name: "compact" }, { name: "computer", input: { hint: "[on|off|status]" } }],
  skills: [
    { name: "grill-me", path: "skill://grill-me", enabled: true },
    { name: "retired", path: "skill://retired", enabled: false },
  ],
});

describe("prepareOhMyPiPrompt", () => {
  it("rewrites known skill mentions to omp's invocation and sends them alone", () => {
    expect(prepareOhMyPiPrompt("please $grill-me the plan", catalog)).toEqual({
      text: "please /skill:grill-me the plan",
      consumedByCommand: true,
    });
    expect(prepareOhMyPiPrompt("$grill-me", catalog)).toEqual({
      text: "/skill:grill-me",
      consumedByCommand: true,
    });
  });

  it("leaves unknown, disabled, and money-looking mentions as prose", () => {
    expect(prepareOhMyPiPrompt("$HOME is set, $retired too, costs $5k", catalog)).toEqual({
      text: "$HOME is set, $retired too, costs $5k",
      consumedByCommand: false,
    });
  });

  it("leaves attached context verbatim and never dispatches from it", () => {
    const envelope =
      '\n\n<t3_context version="1">\n<context kind="terminal" ref="ctx_1">$grill-me</context>\n</t3_context>';
    expect(prepareOhMyPiPrompt(`fix this${envelope}`, catalog)).toEqual({
      text: `fix this${envelope}`,
      consumedByCommand: false,
    });
    expect(prepareOhMyPiPrompt(`$grill-me${envelope}`, catalog)).toEqual({
      text: `/skill:grill-me${envelope}`,
      consumedByCommand: true,
    });
  });

  it("follows omp's prefix rules for inline skill tokens", () => {
    expect(prepareOhMyPiPrompt("/tmp/x is broken, $grill-me", catalog).consumedByCommand).toBe(
      false,
    );
    expect(prepareOhMyPiPrompt("!ls then $grill-me", catalog).consumedByCommand).toBe(false);
    expect(prepareOhMyPiPrompt("/skill:unknown args", catalog).consumedByCommand).toBe(false);
  });

  it("recognises advertised commands by their opening name", () => {
    expect(prepareOhMyPiPrompt("/computer status", catalog).consumedByCommand).toBe(true);
    expect(prepareOhMyPiPrompt("  /compact focus on tests", catalog).consumedByCommand).toBe(true);
    expect(prepareOhMyPiPrompt("/compact:soft", catalog).consumedByCommand).toBe(true);
    expect(prepareOhMyPiPrompt("/vibe", catalog).consumedByCommand).toBe(false);
    expect(prepareOhMyPiPrompt("use /compact later", catalog).consumedByCommand).toBe(false);
  });
});

describe("splitOhMyPiAvailableCommands", () => {
  it("turns skill entries into skills and keeps the rest as slash commands", () => {
    expect(
      splitOhMyPiAvailableCommands([
        { name: "compact", description: "Compact the conversation", input: { hint: "[focus]" } },
        {
          name: "skill:grill-me",
          description: "Interview relentlessly",
          input: { hint: "arguments" },
        },
        { name: "skill:grill-me", description: "duplicate" },
        { name: "skill:", description: "nameless" },
        { name: " ", description: "blank" },
        { name: "trace", description: "" },
      ]),
    ).toEqual({
      slashCommands: [
        { name: "compact", description: "Compact the conversation", input: { hint: "[focus]" } },
        { name: "trace" },
      ],
      skills: [
        {
          name: "grill-me",
          description: "Interview relentlessly",
          path: "skill://grill-me",
          enabled: true,
        },
      ],
    });
  });
});
