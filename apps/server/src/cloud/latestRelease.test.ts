import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { resolveLatestReleaseVersion } from "./latestRelease.ts";

const LATEST_URL = "https://api.github.com/repos/someone/t3code/releases/latest";

const latestReleaseClient = (tagName: string, requests: string[] = []) =>
  HttpClient.make((request) => {
    requests.push(request.url);
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({ tag_name: tagName })),
    );
  });

describe("resolveLatestReleaseVersion", () => {
  it.effect("reads the version from the latest release tag", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const version = yield* resolveLatestReleaseVersion(LATEST_URL).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          latestReleaseClient("v0.0.44-fork.20261002.7", requests),
        ),
      );
      expect(version).toBe("0.0.44-fork.20261002.7");
      expect(requests).toEqual([LATEST_URL]);
    }),
  );

  it.effect("rejects a latest release that is not a t3 version", () =>
    Effect.gen(function* () {
      for (const tagName of ["desktop-latest", "v1.2", "0.0.44"]) {
        const error = yield* resolveLatestReleaseVersion(LATEST_URL).pipe(
          Effect.provideService(HttpClient.HttpClient, latestReleaseClient(tagName)),
          Effect.flip,
        );
        expect(error._tag).toBe("LatestReleaseError");
      }
    }),
  );
});
