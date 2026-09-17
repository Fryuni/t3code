import { OH_MY_PI_DEFAULT_MODEL } from "@t3tools/contracts";
import type { OhMyPiSettings, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";
import { parseGenericCliVersion, spawnAndCollect } from "../providerSnapshot.ts";

const CycleOrderOutput = Schema.Struct({
  key: Schema.Literal("cycleOrder"),
  value: Schema.Array(Schema.NonEmptyString),
  type: Schema.Literal("array"),
  description: Schema.String,
});
const decodeCycleOrder = Schema.decodeEffect(Schema.fromJsonString(CycleOrderOutput));

class OhMyPiModelsError extends Schema.TaggedError<OhMyPiModelsError>()("OhMyPiModelsError", {
  detail: Schema.String,
}) {}

/** Discover the installed CLI's configured model roles without starting an ACP session. */
export const probeOhMyPiModels = Effect.fn("probeOhMyPiModels")(function* (
  settings: Pick<OhMyPiSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) {
  const command = settings.binaryPath || "omp";
  const run = Effect.fn("OhMyPiModels.run")(function* (args: ReadonlyArray<string>) {
    const spawn = yield* resolveSpawnCommand(command, args, { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawn.command, spawn.args, {
        cwd,
        env: environment,
        shell: spawn.shell,
      }),
    );
  });
  const [cycleOrder, version] = yield* Effect.all(
    [
      Effect.gen(function* () {
        const result = yield* run(["config", "get", "cycleOrder", "--json"]);
        if (result.code !== 0) {
          return yield* new OhMyPiModelsError({
            detail: "omp config get cycleOrder --json exited unsuccessfully.",
          });
        }
        return yield* decodeCycleOrder(result.stdout);
      }),
      run(["--version"]).pipe(
        Effect.timeout("4 seconds"),
        Effect.map((result) => (result.code === 0 ? parseGenericCliVersion(result.stdout) : null)),
        Effect.catch(() => Effect.succeed(null)),
      ),
    ],
    { concurrency: "unbounded" },
  );
  const seen = new Set<string>();
  const roles = cycleOrder.value.filter((role) => {
    if (seen.has(role)) return false;
    seen.add(role);
    return true;
  });
  const defaultRole = roles.includes(OH_MY_PI_DEFAULT_MODEL) ? OH_MY_PI_DEFAULT_MODEL : roles[0];
  const models = roles.map((role): ServerProviderModel => ({
    slug: role,
    name: role,
    isDefault: role === defaultRole,
    isCustom: false,
    capabilities: createModelCapabilities({ optionDescriptors: [] }),
  }));
  return { models, version };
}, Effect.timeout("30 seconds"));
