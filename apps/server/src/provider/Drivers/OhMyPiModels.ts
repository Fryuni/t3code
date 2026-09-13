import type { OhMyPiSettings, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";
import { parseGenericCliVersion, spawnAndCollect } from "../providerSnapshot.ts";

const ModelsOutput = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      provider: Schema.NonEmptyString,
      id: Schema.NonEmptyString,
      name: Schema.String,
      thinking: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.NonEmptyString))),
    }),
  ),
});
const decodeModels = Schema.decodeEffect(Schema.fromJsonString(ModelsOutput));

class OhMyPiModelsError extends Schema.TaggedError<OhMyPiModelsError>()("OhMyPiModelsError", {
  detail: Schema.String,
}) {}

/** Discover the installed CLI's catalog without authenticating or starting an ACP session. */
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
  const [catalog, version] = yield* Effect.all(
    [
      Effect.gen(function* () {
        const result = yield* run(["models", "--json"]);
        if (result.code !== 0) {
          return yield* new OhMyPiModelsError({
            detail: "omp models --json exited unsuccessfully.",
          });
        }
        return yield* decodeModels(result.stdout);
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
  const models = catalog.models.flatMap((model): ServerProviderModel[] => {
    const slug = `${model.provider}/${model.id}`;
    if (seen.has(slug)) return [];
    seen.add(slug);
    const thinking = [...new Set(model.thinking ?? [])];
    return [
      {
        slug,
        name: model.name.trim() || model.id,
        subProvider: model.provider,
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors:
            thinking.length > 0
              ? [
                  {
                    id: "thinking",
                    label: "Thinking",
                    type: "select",
                    options: [...new Set(["off", "auto", ...thinking])].map((id) => ({
                      id,
                      label: id === "off" ? "Off" : id === "auto" ? "Auto" : id,
                    })),
                  },
                ]
              : [],
        }),
      },
    ];
  });
  return { models, version };
}, Effect.timeout("30 seconds"));
