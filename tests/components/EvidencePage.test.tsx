import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import EvidencePage from "@/app/trip/[id]/evidence/page";
import { useTripStore } from "@/store/trip-store";
import { chongqingTrip } from "@/data/demo/chongqing";
import { buildTrustMetadata } from "@/services/trust";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: chongqingTrip.id }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

beforeEach(() => {
  const trip = structuredClone(chongqingTrip);
  trip.trust = buildTrustMetadata(trip);
  useTripStore.setState({ trip, revision: 1 });
});

afterEach(cleanup);

describe("EvidencePage", () => {
  it("lists every POI with its source and capture time", () => {
    render(<EvidencePage />);

    expect(screen.getByRole("heading", { name: "证据来源" })).toBeInTheDocument();
    const total = useTripStore.getState().trip.trust!.evidence.length;
    const stats = screen.getByRole("region", { name: "证据统计" });
    expect(within(stats).getAllByText(`${total} 条`).length).toBeGreaterThan(0);
    const [firstPlace] = useTripStore.getState().trip.places;
    expect(screen.getByText(firstPlace.name)).toBeInTheDocument();
    expect(screen.getAllByText(/数据记录时间：/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Demo \/ 估算|人工或未验证/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /返回行程/ })).toHaveAttribute(
      "href",
      `/trip/${chongqingTrip.id}`,
    );
  });

  it("marks estimated evidence separately from real sources", () => {
    render(<EvidencePage />);

    const trip = useTripStore.getState().trip;
    const real = trip.trust!.evidence.filter((card) => card.real).length;
    const estimated = trip.trust!.evidence.length - real;
    const stats = screen.getByRole("region", { name: "证据统计" });
    expect(within(stats).getAllByText(`${real} 条`).length).toBeGreaterThan(0);
    expect(within(stats).getAllByText(`${estimated} 条`).length).toBeGreaterThan(0);
    expect(screen.getAllByText("真实来源").length).toBe(real + 1);
  });

  it("groups evidence by day", () => {
    render(<EvidencePage />);

    for (const day of useTripStore.getState().trip.days) {
      expect(screen.getByRole("region", { name: `Day ${day.index + 1}` })).toBeInTheDocument();
    }
  });
});
