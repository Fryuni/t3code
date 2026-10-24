import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";

// A command name has no further slash, so a first line like `/src/app.ts is broken` stays prose.
const LEADING_SLASH_COMMAND_PATTERN = /^\/[^\s/]+(?:\s|$)/;

// A context link stays with the prompt, which carries the context records.
export const isSetupCommandLine = (line: string) =>
  LEADING_SLASH_COMMAND_PATTERN.test(line) && collectComposerContextReferences(line).length === 0;

/** Whether `offset` starts a line that is still inside a first prompt's leading commands. */
export function startsLeadingSlashCommandLine(text: string, offset: number): boolean {
  if (offset > 0 && text[offset - 1] !== "\n") return false;
  return text
    .slice(0, offset)
    .split("\n")
    .every((line) => line.trim() === "" || isSetupCommandLine(line.trim()));
}

/**
 * A new thread's first prompt split into its leading slash-command lines and the prompt after
 * them, so session-setup commands reach the agent as their own messages first. Blank lines
 * between commands are skipped. Text of only commands keeps the last one as the prompt.
 */
export function splitLeadingSlashCommands(text: string): {
  readonly commands: ReadonlyArray<string>;
  readonly prompt: string;
} {
  const lines = text.split("\n");
  const commands: string[] = [];
  let index = 0;
  for (; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    if (!isSetupCommandLine(line)) break;
    commands.push(line);
  }
  const prompt = lines.slice(index).join("\n").trim();
  if (prompt === "" && commands.length > 0) {
    return { commands: commands.slice(0, -1), prompt: commands.at(-1)! };
  }
  return { commands, prompt };
}
