import { describe, expect, it } from "vite-plus/test";

import { applyLocalhostUrlTemplate, localhostUrlTemplateProblem } from "./localhostUrlTemplate";

const apply = (template: string, url: string): string | null =>
  applyLocalhostUrlTemplate(template, new URL(url))?.href ?? null;

describe("applyLocalhostUrlTemplate", () => {
  it("puts the port in a subdomain and keeps the opened path", () => {
    expect(apply("https://{port}.loem.example.dev", "http://localhost:5173/app/page")).toBe(
      "https://5173.loem.example.dev/app/page",
    );
  });

  it.each([
    ["https://proxy.example.com/ports/{port}", "http://localhost:3000/app", "/ports/3000/app"],
    ["https://proxy.example.com/ports/{port}/", "http://localhost:3000/app", "/ports/3000/app"],
    ["https://proxy.example.com/ports/{port}", "http://localhost:3000/", "/ports/3000/"],
    ["https://proxy.example.com/ports/{port}/", "http://localhost:3000", "/ports/3000/"],
  ])("joins a %s path prefix with the opened path", (template, url, pathname) => {
    expect(applyLocalhostUrlTemplate(template, new URL(url))?.pathname).toBe(pathname);
  });

  it("keeps the opened query and fragment", () => {
    expect(
      apply("https://proxy.example.com/ports/{port}", "http://localhost:3000/app?mode=test#top"),
    ).toBe("https://proxy.example.com/ports/3000/app?mode=test#top");
  });

  it("keeps the opened credentials", () => {
    expect(apply("https://{port}.example.dev", "http://user:p%40ss@localhost:5173/admin")).toBe(
      "https://user:p%40ss@5173.example.dev/admin",
    );
  });

  it.each([
    ["http://localhost/app", "https://80.example.dev/app"],
    ["https://localhost/app", "https://443.example.dev/app"],
  ])("uses the scheme's default port for %s", (url, expected) => {
    expect(apply("https://{port}.example.dev", url)).toBe(expected);
  });

  it.each([
    "http://127.0.0.2:3000/app",
    "http://0.0.0.0:3000/app",
    "http://[::1]:3000/app",
    "http://[::]:3000/app",
    "http://LOCALHOST:3000/app",
  ])("rewrites loopback address %s", (url) => {
    expect(apply("https://{port}.example.dev", url)).toBe("https://3000.example.dev/app");
  });

  it.each([
    "http://example.com:3000/app",
    "http://192.168.1.5:3000/app",
    "http://app.localhost:3000/app",
    "ws://localhost:3000/socket",
    "file:///home/user/index.html",
  ])("leaves %s alone", (url) => {
    expect(apply("https://{port}.example.dev", url)).toBeNull();
  });

  it("substitutes the port into the template's port position", () => {
    expect(apply("https://devbox.vpn:{port}", "http://localhost:5173/app")).toBe(
      "https://devbox.vpn:5173/app",
    );
  });

  it("substitutes every placeholder", () => {
    expect(apply("https://{port}.example.dev/p{port}", "http://localhost:5173/app")).toBe(
      "https://5173.example.dev/p5173/app",
    );
  });

  it("returns null for an unusable template", () => {
    expect(apply("https://proxy.example.com", "http://localhost:5173/")).toBeNull();
    expect(apply("ftp://{port}.example.dev", "http://localhost:5173/")).toBeNull();
  });
});

describe("localhostUrlTemplateProblem", () => {
  it.each([
    "https://{port}.loem.example.dev",
    "https://proxy.example.com/ports/{port}",
    "https://proxy.example.com/ports/{port}/",
    "http://devbox.vpn:{port}",
    "  https://{port}.example.dev  ",
  ])("accepts %s", (template) => {
    expect(localhostUrlTemplateProblem(template)).toBeNull();
  });

  it.each([
    ["https://proxy.example.com/ports", /\{port\}/],
    ["ftp://{port}.example.dev", /http:\/\/ or https:\/\//],
    ["not a url {port}", /full URL/],
    ["{port}", /full URL/],
    ["https://user:secret@{port}.example.dev", /credentials/],
    ["https://{port}.example.dev/?token=1", /query and fragment/],
    ["https://{port}.example.dev/#top", /query and fragment/],
  ])("rejects %s", (template, problem) => {
    expect(localhostUrlTemplateProblem(template)).toMatch(problem);
  });
});
