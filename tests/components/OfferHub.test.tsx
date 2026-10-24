import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OfferHub,
  getOfferInventoryLabel,
  getOfferPriceDescriptor,
  getOfferVerificationLabel,
  offerReservationType,
  offerToReservation,
} from "@/components/travel/OfferHub";
import { useTripStore } from "@/store/trip-store";
import { chongqingTrip } from "@/data/demo/chongqing";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, getJson: vi.fn(), runCommand: vi.fn(), postJson: vi.fn() };
});

import { ApiError, getJson, runCommand } from "@/lib/api-client";

const offer = {
  id: "offer-hotel-1",
  kind: "hotel" as const,
  title: "重庆江景酒店",
  provider: "fliggy" as const,
  city: "重庆",
  checkIn: "2030-05-01",
  checkOut: "2030-05-03",
  priceLabel: "¥680",
  structured: true,
  fetchedAt: "2026-10-22T08:00:00.000Z",
};

beforeEach(() => {
  useTripStore.setState({ trip: structuredClone(chongqingTrip), revision: 1 });
  vi.mocked(getJson).mockReset();
  vi.mocked(runCommand).mockReset();
  vi.mocked(getJson).mockResolvedValue({ capabilities: [] });
});

afterEach(cleanup);

describe("OfferHub", () => {
  it("renders the trip query defaults and the honest empty state", async () => {
    render(<OfferHub />);

    expect(screen.getByRole("heading", { name: "外部实时数据中心" })).toBeInTheDocument();
    expect(screen.getByLabelText("出发地")).toHaveValue(chongqingTrip.origin);
    expect(screen.getByLabelText("目的地")).toHaveValue(chongqingTrip.destination);
    expect(screen.getByText("暂无可验证的外部结果。点击“刷新全部”查询。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "12306 官网首页" })).toBeInTheDocument();
    expect(vi.mocked(getJson)).toHaveBeenCalledWith("/api/voyage/capabilities", expect.anything());
  });

  it("warns when provider capabilities cannot be read", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("能力接口挂了"));
    render(<OfferHub />);

    expect(await screen.findByText(/能力接口挂了；当前不能确认 provider 能力。/)).toBeInTheDocument();
  });

  it("requires at least one category before refreshing", () => {
    render(<OfferHub />);

    for (const label of ["酒店", "高铁", "机票", "门票", "美食", "优惠"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    fireEvent.click(screen.getByRole("button", { name: "刷新全部" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请至少选择一个查询类别");
    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });

  it("refreshes through the runtime command and adopts the returned trip", async () => {
    const refreshed = structuredClone(chongqingTrip);
    refreshed.budget = 9999;
    vi.mocked(runCommand).mockResolvedValue({ trip: refreshed, revision: 7 });

    render(<OfferHub />);
    fireEvent.click(screen.getByRole("button", { name: "刷新全部" }));

    await waitFor(() => expect(useTripStore.getState().revision).toBe(7));
    expect(useTripStore.getState().trip.budget).toBe(9999);
    const [command, input] = vi.mocked(runCommand).mock.calls[0];
    expect(command).toBe("refresh-travel-offers");
    expect(input).toMatchObject({
      tripId: chongqingTrip.id,
      expectedTripRevision: 1,
      categories: ["hotel", "train", "flight", "ticket", "restaurant", "coupon"],
    });
  });

  it("surfaces a revision conflict instead of overwriting newer work", async () => {
    vi.mocked(runCommand).mockRejectedValue(new ApiError("版本冲突", "REVISION_CONFLICT"));
    render(<OfferHub />);

    fireEvent.click(screen.getByRole("button", { name: "刷新全部" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("行程已在其他页面更新，请刷新页面后重试");
  });
});

describe("OfferHub reservation records", () => {
  it("maps quotes to reservation fields without inventing a booking", () => {
    expect(offerReservationType("ticket")).toBe("attraction");
    expect(offerReservationType("coupon")).toBe("other");
    expect(offerToReservation(offer, chongqingTrip)).toMatchObject({
      type: "hotel",
      title: "重庆江景酒店",
      startAt: "2030-05-01T15:00:00",
      endAt: "2030-05-03T12:00:00",
      status: "confirmed",
      provider: "fliggy",
      location: "重庆",
    });
    const noDates = { ...offer, checkIn: undefined, checkOut: undefined, date: undefined };
    expect(offerToReservation(noDates, chongqingTrip).startAt).toBe(`${chongqingTrip.startDate}T15:00:00`);
  });

  it("records a reservation through the runtime and marks the card", async () => {
    const trip = structuredClone(chongqingTrip);
    trip.offers = [offer];
    useTripStore.setState({ trip, revision: 1 });
    const reservation = {
      id: "res-1",
      tripId: trip.id,
      type: "hotel" as const,
      status: "confirmed" as const,
      title: offer.title,
      startAt: "2030-05-01T15:00:00",
      currency: "CNY",
      flexibility: "fixed" as const,
      confirmationCode: "HTL123",
      price: 680,
      provenance: { source: "user" as const, fetchedAt: "2026-10-22T08:00:00.000Z", estimated: false },
    };
    vi.mocked(runCommand).mockResolvedValue({ trip: { ...trip, reservations: [reservation] }, revision: 2 });

    render(<OfferHub />);
    fireEvent.click(screen.getByRole("button", { name: "标记已预订" }));
    fireEvent.change(screen.getByLabelText(/确认号/), { target: { value: "HTL123" } });
    fireEvent.click(screen.getByRole("button", { name: "保存预订记录" }));

    await waitFor(() => expect(vi.mocked(runCommand)).toHaveBeenCalledTimes(1));
    const [command, input] = vi.mocked(runCommand).mock.calls[0];
    expect(command).toBe("add-reservation");
    expect(input).toMatchObject({
      tripId: trip.id,
      expectedTripRevision: 1,
      reservation: {
        type: "hotel",
        title: offer.title,
        startAt: "2030-05-01T15:00:00",
        status: "confirmed",
        confirmationCode: "HTL123",
        price: 680,
      },
    });
    expect(await screen.findByText("已记录预订")).toBeInTheDocument();
    expect(screen.getByText(/Voyage 未代下单/)).toBeInTheDocument();
  });
});

describe("OfferHub evidence labels", () => {
  it("marks text-extracted inventory as unverified", () => {
    expect(getOfferInventoryLabel({ structured: false, availability: "available" })).toBe(
      "文本提取显示可售（需核实）",
    );
    expect(getOfferInventoryLabel({ structured: true, availability: "available" })).toBe(
      "供应商明确显示可售",
    );
  });

  it("distinguishes structured prices from extracted ones", () => {
    expect(getOfferPriceDescriptor({ structured: true, priceLabel: "¥120" })).toBe("报价（需核实）");
    expect(getOfferPriceDescriptor({ structured: false, priceLabel: "¥120" })).toBe("文本中提取的参考价");
    expect(getOfferPriceDescriptor({ structured: true })).toBe("价格未提供");
  });

  it("points train and flight offers at an official verification path", () => {
    expect(getOfferVerificationLabel({ kind: "train", structured: false })).toBe("打开 12306 官网首页");
    expect(getOfferVerificationLabel({ kind: "flight", structured: false })).toBe("打开航班平台首页");
    expect(getOfferVerificationLabel({ kind: "hotel", structured: true, bookingUrl: "https://example.com" })).toBe(
      "打开供应商核实",
    );
  });
});
