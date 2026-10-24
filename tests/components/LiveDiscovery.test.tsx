import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveDiscovery, type DiscoveryResult } from "@/components/travel/LiveDiscovery";
import { useTripStore } from "@/store/trip-store";
import { chongqingTrip } from "@/data/demo/chongqing";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, postJson: vi.fn(), runCommand: vi.fn(), getJson: vi.fn() };
});

import { postJson } from "@/lib/api-client";

const result: DiscoveryResult = {
  id: "amap-B0FFTEST",
  name: "较场口夜市",
  address: "渝中区较场口",
  lat: 29.552,
  lng: 106.577,
  rating: 4.6,
  reviewCount: 3200,
  cost: 45,
  score: 88,
  insight: "本地小吃集中，步行可串联。",
  sourceId: "B0FFTEST",
  fetchedAt: "2026-10-22T08:00:00.000Z",
};

beforeEach(() => {
  useTripStore.setState({ trip: structuredClone(chongqingTrip), revision: 1 });
  vi.mocked(postJson).mockReset();
});

afterEach(cleanup);

describe("LiveDiscovery", () => {
  it("queries the discovery endpoint and renders verified POI results", async () => {
    vi.mocked(postJson).mockResolvedValue({ results: [result] });
    render(<LiveDiscovery city="重庆" kind="food" query="夜市" title="重庆夜市发现" />);

    expect(screen.getByRole("heading", { name: "重庆夜市发现" })).toBeInTheDocument();
    expect(await screen.findByText("较场口夜市")).toBeInTheDocument();
    expect(screen.getByText("本地小吃集中，步行可串联。")).toBeInTheDocument();
    expect(screen.getByText("4.6")).toBeInTheDocument();
    expect(vi.mocked(postJson)).toHaveBeenCalledWith(
      "/api/voyage/discover",
      { city: "重庆", kind: "food", query: "夜市", limit: 12 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("marks results that are already on the map", async () => {
    vi.mocked(postJson).mockResolvedValue({ results: [result] });
    const trip = structuredClone(chongqingTrip);
    trip.places = [
      ...trip.places,
      {
        ...trip.places[0],
        id: "amap-B0FFTEST",
        name: "较场口夜市",
        source: "amap",
        sourceId: "B0FFTEST",
      },
    ];
    useTripStore.setState({ trip, revision: 1 });

    render(<LiveDiscovery city="重庆" kind="food" query="夜市" title="重庆夜市发现" />);

    expect(await screen.findByText("较场口夜市")).toBeInTheDocument();
    expect(screen.getByText("已在地图")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /加入地图标记/ })).not.toBeInTheDocument();
  });

  it("shows an honest empty state when nothing matches", async () => {
    vi.mocked(postJson).mockResolvedValue({ results: [] });
    render(<LiveDiscovery city="重庆" kind="hotel" query="江景" title="重庆江景酒店" />);

    expect(await screen.findByText("没有找到匹配结果，试试更换关键词。")).toBeInTheDocument();
  });

  it("surfaces an upstream failure and lets the user retry", async () => {
    vi.mocked(postJson).mockRejectedValue(new Error("network down"));
    render(<LiveDiscovery city="重庆" kind="hotel" query="江景" title="重庆江景酒店" />);

    await screen.findByRole("button", { name: "重新查询" }, { timeout: 4000 });
    expect(screen.getAllByText("高德实时查询暂时不可用，请点击刷新重试。").length).toBeGreaterThan(0);

    vi.mocked(postJson).mockResolvedValue({ results: [result] });
    screen.getByRole("button", { name: "重新查询" }).click();

    await waitFor(() => expect(screen.getByText("较场口夜市")).toBeInTheDocument(), { timeout: 4000 });
  });
});
