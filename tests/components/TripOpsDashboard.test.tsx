import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TripOpsDashboard } from "@/components/ops/TripOpsDashboard";
import { computeOpsMetrics, type OpsPoint } from "@/services/ops/metrics";
import { useTripStore } from "@/store/trip-store";
import { chongqingTrip } from "@/data/demo/chongqing";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, getJson: vi.fn() };
});

import { getJson } from "@/lib/api-client";

beforeEach(() => {
  useTripStore.setState({ trip: structuredClone(chongqingTrip), revision: 1 });
  vi.mocked(getJson).mockReset();
  vi.mocked(getJson).mockResolvedValue({ source: "mock", pois: [] });
});

afterEach(cleanup);

describe("TripOpsDashboard", () => {
  it("renders KPIs, density, hourly load, day load and estimated crowd risk", async () => {
    render(<TripOpsDashboard />);

    expect(screen.getByRole("heading", { name: /运营看点/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "运营指标" })).toHaveTextContent("POI 数");

    const grid = screen.getByRole("img", { name: "POI 密度网格" });
    expect(grid.querySelectorAll("rect")).toHaveLength(36);
    expect(screen.getByRole("img", { name: "分时负载图" })).toBeInTheDocument();

    const load = screen.getByRole("region", { name: "路线负载" });
    for (const day of chongqingTrip.days) {
      expect(load).toHaveTextContent(`Day ${day.index + 1}`);
    }

    const risk = screen.getByRole("region", { name: "客流风险" });
    expect(risk).toHaveTextContent(/估算/);
    expect(risk).toHaveTextContent(/不能替代景区实时客流数据/);

    expect(screen.getByRole("region", { name: "运营建议" })).toBeInTheDocument();
    expect(screen.getByTestId("ops-export")).toBeInTheDocument();
    await waitFor(() => expect(getJson).toHaveBeenCalled());
  });

  it("uses the city POI sample when the AMap route returns results", async () => {
    vi.mocked(getJson).mockResolvedValue({
      source: "amap",
      pois: [{ sourceId: "B0TEST", name: "测试景点", lng: 106.58, lat: 29.56, type: "风景名胜;景点", rating: 4.7 }],
    });
    render(<TripOpsDashboard />);

    expect(await screen.findByText(/城市 POI 样本 1 个/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "POI 密度网格" })).toBeInTheDocument();
  });

  it("filters by day and risk level", () => {
    render(<TripOpsDashboard />);

    const day2 = screen.getByRole("button", { name: "Day 2" });
    fireEvent.click(day2);
    expect(day2).toHaveAttribute("aria-pressed", "true");

    const high = screen.getByRole("button", { name: "高风险" });
    fireEvent.click(high);
    expect(high).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps metric math consistent and honours an explicit sample", () => {
    const metrics = computeOpsMetrics(chongqingTrip);
    const totalCells = metrics.density.counts.reduce((sum, count) => sum + count, 0);

    expect(totalCells).toBe(metrics.places);
    expect(metrics.dayLoads).toHaveLength(chongqingTrip.days.length);
    expect(metrics.hourly).toHaveLength(chongqingTrip.days.length);
    expect(metrics.hourly.every((entry) => entry.bins.length === 15)).toBe(true);
    expect(metrics.dayLoads.every((load) => load.loadIndex >= 0 && load.loadIndex <= 100)).toBe(true);
    expect(metrics.crowdRisks.every((risk) => risk.score >= 0 && risk.score <= 100)).toBe(true);
    expect(metrics.recommendations.length).toBeGreaterThan(0);

    const sample: OpsPoint[] = [
      { id: "a", name: "A", lat: 29.55, lng: 106.57, category: "attraction", rating: 4.8, reviewCount: 6000, source: "amap" },
      { id: "b", name: "B", lat: 29.56, lng: 106.58, category: "food", rating: 4.6, reviewCount: 1200, source: "amap" },
      { id: "c", name: "C", lat: 29.57, lng: 106.59, category: "food", rating: 4.4, reviewCount: 300, source: "amap" },
    ];
    const withSample = computeOpsMetrics(chongqingTrip, sample);
    expect(withSample.sample).toEqual({ used: true, points: 3 });
    expect(withSample.density.counts.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(withSample.categoryCounts.find((entry) => entry.category === "food")?.count).toBe(2);
  });
});
