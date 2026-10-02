import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { isExactServiceVersion } from "./serviceProtocol.ts";

export class LatestReleaseError extends Schema.TaggedError<LatestReleaseError>()(
  "LatestReleaseError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const decodeLatestRelease = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ tag_name: Schema.String })),
);

const LATEST_RELEASE_TIMEOUT = Duration.seconds(30);

/**
 * Reads the version GitHub marks as a repository's latest release, which
 * already excludes drafts and prereleases. Fork builds update to this, from
 * `t3 update` and from remote self-updates alike, because the upstream
 * versions clients ask for are never published in the fork.
 */
export const resolveLatestReleaseVersion = Effect.fn("cloud.latest_release.resolve")(function* (
  url: string,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const body = yield* httpClient
    .execute(
      HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.mapError(
        () => new LatestReleaseError({ reason: "Could not read the latest t3 release." }),
      ),
      Effect.timeoutOrElse({
        duration: LATEST_RELEASE_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new LatestReleaseError({ reason: "Timed out reading the latest t3 release." }),
          ),
      }),
    );
  const release = yield* decodeLatestRelease(body).pipe(
    Effect.mapError(
      () => new LatestReleaseError({ reason: "The latest t3 release had an unexpected shape." }),
    ),
  );
  const version = /^v(.+)$/.exec(release.tag_name)?.[1];
  if (version === undefined || !isExactServiceVersion(version)) {
    return yield* new LatestReleaseError({
      reason: `The latest release '${release.tag_name}' is not a t3 version.`,
    });
  }
  return version;
});
