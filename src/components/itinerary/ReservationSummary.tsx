import type { Reservation, ReservationStatus, ReservationType } from "@/schemas/reservation";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<ReservationType, string> = {
  flight: "机票",
  train: "火车",
  hotel: "酒店",
  restaurant: "餐厅",
  attraction: "门票",
  activity: "活动",
  car: "租车",
  transfer: "接送",
  other: "其他",
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  tentative: "待确认",
  confirmed: "已确认",
  cancelled: "已取消",
  completed: "已完成",
};

function formatStart(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Read-only list: reservations are recorded here, never booked by Voyage. */
export function ReservationSummary({ reservations }: { reservations: Reservation[] }) {
  if (!reservations.length) return null;
  return (
    <section aria-label="已预订记录" className="rounded-[12px] border border-border bg-background px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium">已记录预订 · {reservations.length}</h3>
        <span className="text-[10px] text-muted-foreground">仅记录，不代下单</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {reservations.map((reservation) => (
          <li key={reservation.id} className="rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{TYPE_LABEL[reservation.type]}</span>
              <span className="font-medium">{reservation.title}</span>
              <span className={cn("text-[10px]", reservation.status === "confirmed" ? "text-emerald-700" : "text-muted-foreground")}>
                {STATUS_LABEL[reservation.status]}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
              {formatStart(reservation.startAt)}
              {reservation.confirmationCode ? ` · 确认号 ${reservation.confirmationCode}` : ""}
              {reservation.price !== undefined ? ` · ¥${reservation.price}` : ""}
              {reservation.provider ? ` · ${reservation.provider}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
        只记录你在官方渠道完成的预订；Voyage 不代下单，也不保存支付信息。
      </p>
    </section>
  );
}
