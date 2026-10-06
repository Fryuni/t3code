import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import {
  applyLocalhostUrlTemplate,
  localhostUrlTemplateProblem,
} from "../../browser/localhostUrlTemplate";
import { saveBrowserLocalhostUrlTemplate } from "../../browser/localhostUrlTemplateSettings";
import { useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";

const EXAMPLE_LOCALHOST_URL = new URL("http://localhost:5173/");

/**
 * Edits the address this device opens a connection's localhost URLs through
 * in the preview browser. Mount it only while open, so each opening starts
 * from the saved template.
 */
export function LocalhostPreviewUrlDialog({
  environmentId,
  environmentLabel,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onClose: () => void;
}) {
  const saved = useClientSettings(
    (settings) => settings.browserLocalhostUrlTemplates[environmentId],
  );
  // Follows the saved template until edited, so a dialog opened while client
  // settings are still loading shows the template once it arrives.
  const [edited, setEdited] = useState<string | null>(null);
  const draft = edited ?? saved ?? "";
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const inputId = useId();
  const errorId = useId();
  const template = draft.trim();
  const problem = template === "" ? null : localhostUrlTemplateProblem(template);
  const example =
    template === "" || problem !== null
      ? null
      : applyLocalhostUrlTemplate(template, EXAMPLE_LOCALHOST_URL);
  const busy = pending !== null;

  const persist = async (action: "save" | "remove", next: string | null) => {
    setPending(action);
    try {
      await saveBrowserLocalhostUrlTemplate(environmentId, next);
      onClose();
    } catch (error) {
      setPending(null);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not ${action} localhost previews`,
          description: error instanceof Error ? error.message : "Client settings are unavailable.",
        }),
      );
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup
        className="max-w-md"
        showCloseButton={!busy}
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || problem !== null) return;
              if (template === "" && saved === undefined) return;
              void persist("save", template === "" ? null : template);
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>Localhost previews</DialogTitle>
          <DialogDescription>
            When a thread on {environmentLabel} opens a localhost URL in the preview browser, this
            device opens it through this address instead. Use it when that machine's ports are
            reachable through a proxy or VPN. Write {"{port}"} where the port number goes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>Address</Label>
            <Input
              id={inputId}
              autoFocus
              font="mono"
              value={draft}
              disabled={busy}
              placeholder="https://{port}.example.com"
              aria-invalid={problem !== null}
              aria-describedby={problem !== null ? errorId : undefined}
              onChange={(event) => setEdited(event.target.value)}
            />
          </div>
          {problem !== null ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : example !== null ? (
            <p className="truncate font-mono text-xs text-muted-foreground">
              localhost:5173 → {example.href.replace(/\/$/u, "")}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {saved !== undefined ? (
            <Button
              type="button"
              variant="destructive-outline"
              className="sm:me-auto"
              disabled={busy}
              onClick={() => void persist("remove", null)}
            >
              {pending === "remove" ? (
                <>
                  <Spinner size="sm" />
                  Removing…
                </>
              ) : (
                "Remove"
              )}
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || problem !== null || (template === "" && saved === undefined)}
          >
            {pending === "save" ? (
              <>
                <Spinner size="sm" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
