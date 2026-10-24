import type { NextRequest } from "next/server";

/**
 * Reads a cookie from either a NextRequest (typed cookies API) or a plain
 * Request (cookie header parsing). Used to live verbatim-duplicated in
 * api-guards.ts and workspace.ts.
 */
export function readRequestCookie(request: Request | NextRequest, name: string): string | undefined {
  if ("cookies" in request && request.cookies) return request.cookies.get(name)?.value;
  const header = request.headers.get("cookie") ?? "";
  // Split on the first "=" only: cookie values may legitimately contain "="
  // (base64 padding, signed tokens). Splitting on every "=" truncates them.
  for (const part of header.split(";")) {
    const entry = part.trim();
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    if (entry.slice(0, separator) === name) return entry.slice(separator + 1);
  }
  return undefined;
}
