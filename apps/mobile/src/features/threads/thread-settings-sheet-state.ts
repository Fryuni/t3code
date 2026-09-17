import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";

const OH_MY_PI_DRIVER = "ohMyPi";
const OH_MY_PI_DEFAULT_MODEL = "default";
const OH_MY_PI_LEGACY_DEFAULT_MODEL = "oh-my-pi-default";

function comparableModel(model: string, providerDriver: string | undefined): string {
  if (providerDriver !== OH_MY_PI_DRIVER) {
    return model;
  }
  return model === OH_MY_PI_LEGACY_DEFAULT_MODEL ? OH_MY_PI_DEFAULT_MODEL : model;
}

/** Compare the role identity a running provider session binds to. */
export function threadRoleSelectionsMatch(input: {
  readonly providerDriver: string | undefined;
  readonly current: ModelOption["selection"];
  readonly next: ModelOption["selection"];
}): boolean {
  return (
    input.current.instanceId === input.next.instanceId &&
    comparableModel(input.current.model, input.providerDriver) ===
      comparableModel(input.next.model, input.providerDriver)
  );
}

/** A provider session that binds its role cannot switch to a different role in-place. */
export function startedThreadModelChangeBlockReason(input: {
  readonly hasStartedSession: boolean;
  readonly requiresNewThreadForModelChange: boolean;
  readonly providerDriver: string | undefined;
  readonly current: ModelOption["selection"] | null;
  readonly next: ModelOption["selection"];
}): string | null {
  if (
    !input.hasStartedSession ||
    !input.requiresNewThreadForModelChange ||
    input.current === null
  ) {
    return null;
  }
  if (
    threadRoleSelectionsMatch({
      providerDriver: input.providerDriver,
      current: input.current,
      next: input.next,
    })
  ) {
    return null;
  }
  return "This provider fixes the role after a conversation has started.";
}

/** Match the terms a user can actually see or recognize in the model picker. */
export function modelMatchesCatalogQuery(input: {
  readonly model: ModelOption;
  readonly providerLabel: string;
  readonly query: string;
}): boolean {
  const query = input.query.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return true;
  }

  return [
    input.model.label,
    input.model.subtitle,
    input.model.selection.model,
    input.providerLabel,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

/** Preserve staged provider options when the highlighted model is tapped again. */
export function pendingModelAfterPress(input: {
  readonly current: ModelOption | null;
  readonly pressed: ModelOption;
  readonly pressedIsApplied: boolean;
}): ModelOption | null {
  if (input.pressedIsApplied) {
    return null;
  }
  return input.current?.key === input.pressed.key ? input.current : input.pressed;
}

/** A model can disappear while the picker is open. */
export function canCommitPendingModel(
  pending: ModelOption,
  groups: ReadonlyArray<ProviderGroup>,
): boolean {
  return groups.some((group) =>
    group.models.some((model) => model.key === pending.key && !model.isUnavailable),
  );
}

/**
 * Primary and selected providers start open; all other catalogs start closed.
 * A user's disclosure tap inverts that default until the picker is dismissed.
 */
export function providerSectionIsCollapsed(input: {
  readonly defaultExpanded: boolean;
  readonly hasExpansionOverride: boolean;
  readonly isNarrowed: boolean;
}): boolean {
  if (input.isNarrowed) {
    return false;
  }
  return input.defaultExpanded ? input.hasExpansionOverride : !input.hasExpansionOverride;
}
