import type { ComposerContextId } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";
import { splitLeadingSlashCommands, startsLeadingSlashCommandLine } from "./setupCommands.ts";

describe("splitLeadingSlashCommands", () => {
  it("splits leading command lines from the prompt after them", () => {
    expect(
      splitLeadingSlashCommands("/caveman lite\n\n /model opus\nFix the bug\n/not a command"),
    ).toEqual({
      commands: ["/caveman lite", "/model opus"],
      prompt: "Fix the bug\n/not a command",
    });
  });

  it("keeps the last command as the prompt when nothing follows", () => {
    expect(splitLeadingSlashCommands("/one\n/two")).toEqual({ commands: ["/one"], prompt: "/two" });
    expect(splitLeadingSlashCommands("/review 12")).toEqual({ commands: [], prompt: "/review 12" });
  });

  it("leaves paths and prose that start with a slash alone", () => {
    expect(splitLeadingSlashCommands("/src/app.ts is broken\nfix it")).toEqual({
      commands: [],
      prompt: "/src/app.ts is broken\nfix it",
    });
    expect(splitLeadingSlashCommands("// note\nfix it").commands).toEqual([]);
  });

  it("keeps a line with a context link in the prompt that carries its records", () => {
    const terminal = formatComposerContextReference({
      kind: "terminal",
      contextId: "terminal_1" as ComposerContextId,
      label: "Terminal",
    });
    expect(splitLeadingSlashCommands(`/setup\n/review ${terminal}\nFix it`)).toEqual({
      commands: ["/setup"],
      prompt: `/review ${terminal}\nFix it`,
    });
  });
});

describe("startsLeadingSlashCommandLine", () => {
  it("accepts line starts below only commands and blank lines", () => {
    const text = "/one\n\n/two on\n/";
    expect(startsLeadingSlashCommandLine(text, 0)).toBe(true);
    expect(startsLeadingSlashCommandLine(text, text.length - 1)).toBe(true);
    expect(startsLeadingSlashCommandLine(text, 2)).toBe(false);
    expect(startsLeadingSlashCommandLine("Fix it\n/", 7)).toBe(false);
  });
});
