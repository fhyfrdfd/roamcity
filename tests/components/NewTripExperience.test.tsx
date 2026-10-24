import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { NewTripExperience } from "@/features/new-trip/NewTripExperience";
import { usePlanningStore } from "@/store/planning-store";

const mocks = vi.hoisted(() => ({ searchParams: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string | { pathname?: string }; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, postEnvelopeData: vi.fn(), getEnvelopeData: vi.fn() };
});

import { postEnvelopeData } from "@/lib/api-client";

const sessionPayload = {
  sessionId: "sess-test",
  revision: 1,
  assistantMessage: "你好，先说说你的计划。",
  profile: { destination: "重庆", days: 3 },
  suggestedReplies: ["轻松一点"],
  llmStatus: { state: "ready" },
  missingFields: [],
  readyToGenerate: true,
  days: 3,
};

beforeEach(() => {
  localStorage.clear();
  usePlanningStore.getState().clearSession();
  vi.mocked(postEnvelopeData).mockReset();
});

afterEach(cleanup);

describe("NewTripExperience", () => {
  it("starts from the idea composer with the example prompt", () => {
    render(<NewTripExperience />);
    expect(screen.getByRole("heading", { name: "先说说这趟旅行" })).toBeInTheDocument();
    expect((screen.getByLabelText("旅行初始想法") as HTMLTextAreaElement).value).toContain("成都");
    expect(screen.getByRole("button", { name: /开始对话/ })).toBeEnabled();
  });

  it("creates a planning session and adopts the assistant reply", async () => {
    vi.mocked(postEnvelopeData).mockResolvedValue(sessionPayload);
    render(<NewTripExperience />);

    fireEvent.change(screen.getByLabelText("旅行初始想法"), { target: { value: "去重庆玩三天，喜欢美食" } });
    fireEvent.click(screen.getByRole("button", { name: /开始对话/ }));

    expect(await screen.findByText(/你好，先说说你的计划/)).toBeInTheDocument();
    expect(vi.mocked(postEnvelopeData)).toHaveBeenCalledTimes(1);
    const [url, body] = vi.mocked(postEnvelopeData).mock.calls[0];
    expect(url).toBe("/api/voyage/planning/session");
    expect(body).toMatchObject({ prompt: "去重庆玩三天，喜欢美食" });
  });

  it("surfaces a session-creation failure instead of silently continuing", async () => {
    vi.mocked(postEnvelopeData).mockRejectedValue(new Error("上游不可用"));
    render(<NewTripExperience />);

    fireEvent.click(screen.getByRole("button", { name: /开始对话/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/上游不可用|规划会话创建失败/));
    expect(screen.getByRole("heading", { name: "先说说这趟旅行" })).toBeInTheDocument();
  });
});
