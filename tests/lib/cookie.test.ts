import { describe, expect, it } from "vitest";

import { readRequestCookie } from "@/lib/cookie";

function requestWithCookie(header: string) {
  return new Request("http://localhost/api", { headers: { cookie: header } });
}

describe("readRequestCookie", () => {
  it("preserves '=' inside a cookie value", () => {
    expect(readRequestCookie(requestWithCookie("session=abc==; theme=dark"), "session")).toBe("abc==");
  });

  it("finds a cookie among several and trims whitespace", () => {
    expect(readRequestCookie(requestWithCookie("a=1;  voyage_guest_workspace=uuid-1 ; b=2"), "voyage_guest_workspace")).toBe("uuid-1");
  });

  it("does not match a name that is only a prefix", () => {
    expect(readRequestCookie(requestWithCookie("voyage_guest_workspace_extra=x; voyage_guest_workspace=y"), "voyage_guest_workspace")).toBe("y");
  });

  it("returns undefined for missing or empty headers", () => {
    expect(readRequestCookie(requestWithCookie(""), "session")).toBeUndefined();
    expect(readRequestCookie(requestWithCookie("other=1"), "session")).toBeUndefined();
    expect(readRequestCookie(requestWithCookie("=orphan"), "session")).toBeUndefined();
  });

  it("uses the typed cookies API when available", () => {
    const nextRequest = {
      cookies: { get: (name: string) => (name === "session" ? { value: "typed=value" } : undefined) },
    } as unknown as Request;
    expect(readRequestCookie(nextRequest, "session")).toBe("typed=value");
  });
});
