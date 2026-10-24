import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { XhsGuidePanel } from "@/components/travel/XhsGuidePanel";
import { useTripStore } from "@/store/trip-store";
import { chongqingTrip } from "@/data/demo/chongqing";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, postEnvelopeResult: vi.fn() };
});

import { postEnvelopeResult } from "@/lib/api-client";

const place = structuredClone(chongqingTrip.places[0]);

const post = {
  platform: "xiaohongshu",
  sourceId: "note-1",
  summary: "重庆两天一晚经典路线：朝天门 → 洪崖洞",
  content: "Day1 朝天门看两江交汇，晚上去洪崖洞看夜景。",
  fetchedAt: "2026-10-22T08:00:00.000Z",
  metrics: { likes: 1200, comments: 88 },
};

const parsed = {
  extractionSource: "rules" as const,
  resolvedCount: 1,
  candidates: [{ name: place.name, resolved: true, place, matchBasis: "exact" as const }],
};

beforeEach(() => {
  useTripStore.setState({ trip: structuredClone(chongqingTrip), revision: 1 });
  vi.mocked(postEnvelopeResult).mockReset();
});

afterEach(cleanup);

describe("XhsGuidePanel", () => {
  it("renders the guide entry points and categories", () => {
    render(<XhsGuidePanel city="重庆" />);

    expect(screen.getByRole("region", { name: /攻略导入/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /获取攻略/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "精选路线" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "必吃美食" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /粘贴攻略文本/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("searches the selected category and renders returned notes", async () => {
    vi.mocked(postEnvelopeResult).mockResolvedValue({
      data: { posts: [post], platformStatus: { xiaohongshu: "ok" } },
      warnings: [],
    });

    render(<XhsGuidePanel city="重庆" />);
    fireEvent.click(screen.getByRole("button", { name: /获取攻略/ }));

    expect(await screen.findByText(post.summary)).toBeInTheDocument();
    expect(screen.getByText("已从小红书获取「精选路线」公开笔记")).toBeInTheDocument();
    expect(vi.mocked(postEnvelopeResult)).toHaveBeenCalledWith("/api/voyage/social/guide", {
      city: "重庆",
      query: "旅游攻略 路线",
      category: "route",
    });
  });

  it("only queries after a category switch when a search already ran", async () => {
    vi.mocked(postEnvelopeResult).mockResolvedValue({
      data: { posts: [], platformStatus: { xiaohongshu: "ok" } },
      warnings: [],
    });

    render(<XhsGuidePanel city="重庆" />);
    fireEvent.click(screen.getByRole("button", { name: "必吃美食" }));
    expect(vi.mocked(postEnvelopeResult)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /获取攻略/ }));
    await waitFor(() => expect(vi.mocked(postEnvelopeResult)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postEnvelopeResult).mock.calls[0][1]).toMatchObject({ category: "food" });

    fireEvent.click(screen.getByRole("button", { name: "最新笔记" }));
    await waitFor(() => expect(vi.mocked(postEnvelopeResult)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(postEnvelopeResult).mock.calls[1][1]).toMatchObject({ category: "latest" });
  });

  it("shows a custom search box that submits the typed keyword", async () => {
    vi.mocked(postEnvelopeResult).mockResolvedValue({
      data: { posts: [], platformStatus: { xiaohongshu: "ok" } },
      warnings: [],
    });

    render(<XhsGuidePanel city="重庆" />);
    fireEvent.click(screen.getByRole("button", { name: "自定义搜索" }));
    const input = screen.getByPlaceholderText("输入任意小红书搜索词…");
    fireEvent.change(input, { target: { value: "解放碑 咖啡馆" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => expect(vi.mocked(postEnvelopeResult)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postEnvelopeResult).mock.calls[0][1]).toMatchObject({
      city: "重庆",
      query: "解放碑 咖啡馆",
      category: "custom",
    });
  });

  it("explains an upstream failure instead of pretending results exist", async () => {
    vi.mocked(postEnvelopeResult).mockRejectedValue(new Error("小红书上游超时"));

    render(<XhsGuidePanel city="重庆" />);
    fireEvent.click(screen.getByRole("button", { name: /获取攻略/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("小红书上游超时");
    expect(screen.queryByText("已从小红书获取「精选路线」公开笔记")).not.toBeInTheDocument();
  });

  it("parses a note into verified places and enables adding them", async () => {
    vi.mocked(postEnvelopeResult).mockImplementation(async (url) => {
      if (url === "/api/voyage/social/guide") {
        return { data: { posts: [post], platformStatus: { xiaohongshu: "ok" } }, warnings: [] };
      }
      if (url === "/api/voyage/social/extract-places") {
        return { data: parsed, warnings: [] };
      }
      throw new Error(`unexpected url ${url}`);
    });

    render(<XhsGuidePanel city="重庆" />);
    fireEvent.click(screen.getByRole("button", { name: /获取攻略/ }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(post.summary) }));

    expect(await screen.findByText(/候选地点由规则从原文抽取/)).toBeInTheDocument();
    expect(screen.getByText(/1\/1 个找到真实地点/)).toBeInTheDocument();
    expect(screen.getByText(place.name)).toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: "加入所选地点" });
    expect(addButton).toBeEnabled();
    const call = vi.mocked(postEnvelopeResult).mock.calls.find(([url]) => url === "/api/voyage/social/extract-places");
    expect(call?.[1]).toMatchObject({ city: "重庆", text: post.content });
  });
});
