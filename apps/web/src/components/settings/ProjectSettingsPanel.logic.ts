export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

/**
 * Checkouts are listed whenever a second machine could hold one. Machines that
 * are connected but lack a checkout of the project can receive a new one.
 */
export function projectCheckoutOptions<
  TEnvironment extends { readonly environmentId: string },
>(input: {
  readonly connectedEnvironments: ReadonlyArray<TEnvironment>;
  readonly checkoutEnvironmentIds: ReadonlyArray<string>;
  readonly checkoutCount: number;
  readonly canCheckOut: boolean;
}): { readonly visible: boolean; readonly targets: ReadonlyArray<TEnvironment> } {
  const checkedOut = new Set(input.checkoutEnvironmentIds);
  return {
    visible: input.checkoutCount > 1 || input.connectedEnvironments.length > 1,
    targets: input.canCheckOut
      ? input.connectedEnvironments.filter(
          (environment) => !checkedOut.has(environment.environmentId),
        )
      : [],
  };
}
