/**
 * Localhost URL templates: how a connection's localhost ports are reachable
 * from this device, written as a URL with a `{port}` placeholder such as
 * `https://{port}.dev.example.com` or `https://proxy.example.com/ports/{port}`.
 *
 * Kept pure so the settings dialog and the preview URL resolver agree on
 * what a usable template is and what it turns a localhost URL into.
 *
 * @module localhostUrlTemplate
 */
import { isLocalLoopbackHost, normalizeHostname } from "@t3tools/shared/hostClassification";

export const LOCALHOST_URL_TEMPLATE_PORT_PLACEHOLDER = "{port}";

const SAMPLE_PORT = 5173;

const substitutePort = (template: string, port: number): URL | null => {
  try {
    return new URL(
      template.trim().replaceAll(LOCALHOST_URL_TEMPLATE_PORT_PLACEHOLDER, String(port)),
    );
  } catch {
    return null;
  }
};

/** Loopback as a dev server prints it: localhost, 127.0.0.0/8, ::1, or the 0.0.0.0/:: any-address. */
export function isLocalhostAddress(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return isLocalLoopbackHost(normalized) || normalized === "0.0.0.0" || normalized === "::";
}

/**
 * Why a template can't be used, worded for the settings dialog, or null when
 * it can. The placeholder is substituted before parsing because `{port}` is
 * not valid in every URL position (`https://host:{port}` doesn't parse).
 */
export function localhostUrlTemplateProblem(template: string): string | null {
  if (!template.includes(LOCALHOST_URL_TEMPLATE_PORT_PLACEHOLDER)) {
    return "Include {port} where the port number goes.";
  }
  const sample = substitutePort(template, SAMPLE_PORT);
  if (sample === null) return "Enter a full URL, such as https://{port}.example.com.";
  if (sample.protocol !== "http:" && sample.protocol !== "https:") {
    return "Use an http:// or https:// URL.";
  }
  if (sample.username !== "" || sample.password !== "") {
    return "Leave credentials out of the template.";
  }
  if (sample.search !== "" || sample.hash !== "") {
    return "Leave out the query and fragment. They come from the URL being opened.";
  }
  return null;
}

/**
 * The URL a localhost `url` opens at through `template`, or null when the URL
 * isn't localhost or the template is unusable. The template supplies the
 * scheme, host, port and an optional path prefix; the opened URL keeps its
 * path, query, fragment and credentials.
 */
export function applyLocalhostUrlTemplate(template: string, url: URL): URL | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isLocalhostAddress(url.hostname)) return null;
  if (localhostUrlTemplateProblem(template) !== null) return null;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const rewritten = substitutePort(template, port);
  if (rewritten === null) return null;
  rewritten.pathname = `${rewritten.pathname.replace(/\/+$/u, "")}${url.pathname}`;
  rewritten.search = url.search;
  rewritten.hash = url.hash;
  rewritten.username = url.username;
  rewritten.password = url.password;
  return rewritten;
}
