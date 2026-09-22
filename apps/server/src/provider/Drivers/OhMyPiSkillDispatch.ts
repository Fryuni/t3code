/**
 * OhMyPiSkillDispatch — turns a composer prompt into what omp runs over ACP.
 *
 * omp invokes a skill as `/skill:<name>`. The token is honored when it opens
 * the prompt, or inline when the prompt does not open with another `/`, `!`,
 * or `$` prefix; the text on either side becomes the skill's arguments. The
 * composer inserts `$name` for every provider, so known mentions are rewritten
 * in place, like the Cursor rewrite.
 *
 * omp joins ACP text blocks with a blank line before parsing. A prompt that a
 * builtin command or a skill consumes must therefore travel alone: the runtime
 * instructions block would be folded into the command's arguments, and strict
 * commands such as `/computer status` then print their usage line instead of
 * running. Verified against omp 18.2.7.
 *
 * @module provider/Drivers/OhMyPiSkillDispatch
 */
import type {
  ServerProviderSkill,
  ServerProviderSlashCommand,
  ServerProviderWorkspaceSnapshot,
} from "@t3tools/contracts";

/**
 * Same token shape the Claude and Cursor skill dispatchers use, so a `$name`
 * one provider runs, another runs too. It is one character looser than the
 * composer chip pattern (`packages/shared/src/composerInlineTokens.ts`), which
 * also needs trailing whitespace: a mention that ends the prompt still
 * dispatches, matching the CLIs' own parsing.
 */
const SKILL_MENTION_PATTERN =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;
/** omp's inline skill token: the first match decides, and its name may not contain `/`. */
const SKILL_TOKEN_PATTERN = /(^|\s)\/skill:([^\s/]+)(?=\s|$)/u;
const SKILL_COMMAND_PREFIX = "skill:";

export interface OhMyPiWorkspaceCatalog {
  /** Names omp advertised as commands, without the `skill:` entries. */
  readonly commandNames: ReadonlySet<string>;
  readonly skillNames: ReadonlySet<string>;
}

export interface OhMyPiPreparedPrompt {
  readonly text: string;
  /** omp itself consumes the prompt (a command or a skill), so nothing else may share it. */
  readonly consumedByCommand: boolean;
}

export function ohMyPiWorkspaceCatalog(
  workspace: Pick<ServerProviderWorkspaceSnapshot, "slashCommands" | "skills"> | undefined,
): OhMyPiWorkspaceCatalog {
  return {
    commandNames: new Set(workspace?.slashCommands.map((command) => command.name) ?? []),
    skillNames: new Set(
      workspace?.skills.filter((skill) => skill.enabled).map((skill) => skill.name) ?? [],
    ),
  };
}

export function prepareOhMyPiPrompt(
  prompt: string,
  catalog: OhMyPiWorkspaceCatalog,
): OhMyPiPreparedPrompt {
  const text = prompt.replace(SKILL_MENTION_PATTERN, (match, prefix: string, name: string) =>
    catalog.skillNames.has(name) ? `${prefix}/${SKILL_COMMAND_PREFIX}${name}` : match,
  );
  return {
    text,
    consumedByCommand:
      invokesSkill(text, catalog.skillNames) || opensWithCommand(text, catalog.commandNames),
  };
}

/** Mirrors omp's `parseSkillInvocation`: an unknown name falls through to the model as text. */
function invokesSkill(text: string, skillNames: ReadonlySet<string>): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith(`/${SKILL_COMMAND_PREFIX}`)) {
    const end = trimmed.search(/\s/);
    const name = trimmed.slice(1 + SKILL_COMMAND_PREFIX.length, end === -1 ? undefined : end);
    return name.length > 0 && skillNames.has(name);
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("!") || trimmed.startsWith("$")) {
    return false;
  }
  const match = SKILL_TOKEN_PATTERN.exec(text);
  return match !== null && skillNames.has(match[2] ?? "");
}

/** omp ends a command name at the first whitespace or `:`. */
function opensWithCommand(text: string, commandNames: ReadonlySet<string>): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return false;
  const name = trimmed.slice(1).split(/[\s:]/u, 1)[0] ?? "";
  return name.length > 0 && commandNames.has(name);
}

/**
 * omp advertises each skill as a `skill:<name>` command. Those become `$`
 * skills, identified only by omp's own `skill://` scheme, and leave the slash
 * menu; everything else stays a slash command.
 */
export function splitOhMyPiAvailableCommands(
  commands: ReadonlyArray<{
    readonly name: string;
    readonly description?: string | null;
    readonly input?: { readonly hint: string } | null;
  }>,
): {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
} {
  const slashCommands: ServerProviderSlashCommand[] = [];
  const skills: ServerProviderSkill[] = [];
  const seenSkills = new Set<string>();
  for (const command of commands) {
    const name = command.name.trim();
    if (!name) continue;
    const description = command.description?.trim();
    if (name.startsWith(SKILL_COMMAND_PREFIX)) {
      const skillName = name.slice(SKILL_COMMAND_PREFIX.length);
      if (!skillName || seenSkills.has(skillName)) continue;
      seenSkills.add(skillName);
      skills.push({
        name: skillName,
        ...(description ? { description } : {}),
        path: `skill://${skillName}`,
        enabled: true,
      });
      continue;
    }
    const hint = command.input?.hint.trim();
    slashCommands.push({
      name,
      ...(description ? { description } : {}),
      ...(hint ? { input: { hint } } : {}),
    });
  }
  return { slashCommands, skills };
}
