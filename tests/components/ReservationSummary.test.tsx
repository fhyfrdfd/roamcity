import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReservationSummary } from "@/components/itinerary/ReservationSummary";
import type { Reservation } from "@/schemas/reservation";

const reservation: Reservation = {
  id: "res-1",
  tripId: "chongqing-2026",
  type: "hotel",
  status: "confirmed",
  title: "重庆江景酒店",
  startAt: "2030-05-01T15:00:00",
  currency: "CNY",
  flexibility: "fixed",
  confirmationCode: "HTL123",
  price: 680,
  provider: "fliggy",
  notes: "由报价卡手动记录",
  provenance: { source: "user", fetchedAt: "2026-10-22T08:00:00.000Z", estimated: false },
};

afterEach(cleanup);

describe("ReservationSummary", () => {
  it("lists recorded reservations without implying Voyage booked them", () => {
    render(<ReservationSummary reservations={[reservation]} />);

    const section = screen.getByRole("region", { name: "已预订记录" });
    expect(section).toHaveTextContent("已记录预订 · 1");
    expect(section).toHaveTextContent("重庆江景酒店");
    expect(section).toHaveTextContent("酒店");
    expect(section).toHaveTextContent("已确认");
    expect(section).toHaveTextContent("确认号 HTL123");
    expect(section).toHaveTextContent("¥680");
    expect(section).toHaveTextContent("Voyage 不代下单，也不保存支付信息");
  });

  it("renders nothing when no reservation exists", () => {
    const { container } = render(<ReservationSummary reservations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
