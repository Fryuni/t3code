import { makeThreadPullRequests } from "@t3tools/source-control-core/shared/threadPullRequests";

import { sourceControlDefinitions } from "./sourceControlDefinitions.ts";

export const {
  normalizeThreadPullRequestKey,
  legacyThreadPullRequestKey,
  visibleThreadPullRequests,
  threadPullRequestKeysEqual,
  threadPullRequestKeyOf,
  resolveThreadPullRequestChains,
  threadPullRequestsOf,
  applyThreadPullRequestLinkUpdate,
} = makeThreadPullRequests(sourceControlDefinitions);
