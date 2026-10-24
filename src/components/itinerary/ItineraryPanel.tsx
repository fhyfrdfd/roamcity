"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { DayTimeline } from "./DayTimeline";
import { DayTabs } from "./DayTabs";
import { DayFocusCard } from "./DayFocusCard";
import { useDayFocus } from "./useDayFocus";
import { SocialEvidencePanel } from "./SocialEvidencePanel";
import { ReservationSummary } from "./ReservationSummary";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTripStore } from "@/store/trip-store";
import { useUiStore, type WorkspaceTab } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setTaskStatus, TripCommandError } from "@/services/trip-commands";
import { resyncTrip } from "@/store/trip-store";
import type { TaskStatus, Trip } from "@/types/travel";
import type { TripChangeSet } from "@/types/diff";
import { ShieldCheck, TriangleAlert, LoaderCircle, WandSparkles } from "lucide-react";
import { ApiError, postEnvelope } from "@/lib/api-client";
import { TripDiffModal } from "@/components/ai/TripDiffModal";
import { useHistoryStore } from "@/store/history-store";

/**
 * The tasks tab renders inline (the standalone /tasks page was removed with
 * the page-count reduction). Toggles persist through the runtime now — they
 * participate in the same check-in linkage as the today screen.
 */
function TaskList() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const setTrip = useTripStore((s) => s.setTrip);
  const revision = useTripStore((s) => s.revision);
  const done = trip.tasks.filter((t) => t.status === "done").length;
  const before = trip.tasks.filter((t) => t.group === "before");
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const toggle = (id: string) => {
    const task = trip.tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    const nextStatus: TaskStatus = task.status === "done" ? "todo" : "done";
    // Optimistic flip, then a revision-locked server write with rollback.
    patch((t) => ({
      ...t,
      tasks: t.tasks.map((candidate) =>
        candidate.id === id ? { ...candidate, status: nextStatus } : candidate,
      ),
    }));
    setSavingTaskId(id);
    void setTaskStatus({ tripId: trip.id, taskId: id, status: nextStatus, expectedTripRevision: useTripStore.getState().revision })
      .then(({ trip: saved, revision: savedRevision }) => {
        setTrip(saved, savedRevision);
        setSavingTaskId(null);
      })
      .catch((cause) => {
        setTrip(trip, revision);
        setSavingTaskId(null);
        if (cause instanceof TripCommandError && cause.code === "REVISION_CONFLICT") {
          // Roll back the optimistic flip but re-sync — the stale revision
          // would otherwise fail every later write until a manual reload.
          toast.error("行程已在别处更新，已同步最新版本，请重试");
          void resyncTrip(trip.id);
          return;
        }
        toast.error(cause instanceof TripCommandError ? cause.message : "任务状态保存失败，请重试");
      });
  };

  if (trip.tasks.length === 0 && !(trip.reservations?.length)) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">这趟行程暂无待办任务。</p>;
  }

  return (
    <div className="space-y-5 px-4 pb-6">
      <ReservationSummary reservations={trip.reservations ?? []} />
      {trip.tasks.length ? (
        <>
          <p className="text-right text-[13px] text-muted-foreground">{done} / {trip.tasks.length}</p>
          <section>
            <h3 className="text-[13px] font-medium text-muted-foreground">旅行前</h3>
            <ul className="mt-2 space-y-1">
              {before.map((task) => (
                <TaskRow
                  key={task.id}
                  title={task.title}
                  done={task.status === "done"}
                  disabled={savingTaskId === task.id}
                  onToggle={() => toggle(task.id)}
                />
              ))}
            </ul>
          </section>
          {trip.days.map((day) => {
            const items = trip.tasks.filter((t) => t.dayId === day.id);
            if (!items.length) return null;
            return (
              <section key={day.id}>
                <h3 className="text-[13px] font-medium text-muted-foreground">Day {day.index + 1}</h3>
                <ul className="mt-2 space-y-1">
                  {items.map((task) => (
                    <TaskRow
                      key={task.id}
                      title={task.title}
                      done={task.status === "done"}
                      checkin={task.checkin}
                      disabled={savingTaskId === task.id}
                      onToggle={() => toggle(task.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      ) : (
        <p className="py-2 text-center text-sm text-muted-foreground">这趟行程暂无待办任务。</p>
      )}
    </div>
  );
}

function TaskRow({
  title,
  done,
  checkin,
  disabled = false,
  onToggle,
}: {
  title: string;
  done: boolean;
  checkin?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-[10px] px-2 py-2 hover:bg-secondary">
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "grid size-4 place-items-center rounded border transition-opacity",
          done ? "border-primary bg-primary text-[10px] text-white" : "border-border",
          disabled && "opacity-50",
        )}
        aria-checked={done}
        role="checkbox"
      >
        {done ? "✓" : ""}
      </button>
      <span className={cn("flex-1 text-sm", done && "text-muted-foreground line-through")}>{title}</span>
      {checkin ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" />
          到达后打卡
        </span>
      ) : null}
    </li>
  );
}

export function ItineraryPanel() {
  const trip = useTripStore((s) => s.trip);
  const setTrip = useTripStore((s) => s.setTrip);
  const pushHistory = useHistoryStore((s) => s.push);
  const tab = useUiStore((s) => s.workspaceTab);
  const setTab = useUiStore((s) => s.setWorkspaceTab);
  const router = useRouter();
  const activeDayId = useDayFocus();
  const reduceMotion = useReducedMotion();

  // Focusing one day by default is the whole point: a traveller looking at
  // "Day 2" should not have to read three days of stops at once. "全部" is an
  // explicit choice, so null still renders every day.
  const visibleDays = activeDayId === null ? trip.days : trip.days.filter((day) => day.id === activeDayId);
  // The focus card answers "what do I do today", so it only appears when a
  // single day is in focus — not in the all-days overview.
  const focusedDay = activeDayId === null ? undefined : visibleDays[0];
  const trust = trip.trust;
  const trustErrors = trust?.validation.issues.filter((issue) => issue.severity === "error") ?? [];
  const trustWarnings = trust?.validation.issues.filter((issue) => issue.severity === "warning") ?? [];
  const [trustBusy, setTrustBusy] = useState(false);
  const [trustDiff, setTrustDiff] = useState<TripChangeSet | null>(null);
  const [trustDiffOpen, setTrustDiffOpen] = useState(false);
  const [trustRemote, setTrustRemote] = useState<{ tripId: string; proposalId: string; baseRevision: number; proposalToken: string } | null>(null);

  const requestTrustRepair = () => {
    if (trustBusy) return;
    void (async () => {
      setTrustBusy(true);
      try {
        const envelope = await postEnvelope<{
          proposalId: string | null;
          proposalToken?: string;
          baseRevision: number;
          changes?: TripChangeSet | null;
          summary?: string;
        }>("/api/voyage/replan", {
          tripId: trip.id,
          expectedTripRevision: useTripStore.getState().revision,
        });
        if (!envelope.ok || !envelope.data) throw new ApiError(envelope.error?.message ?? "修复方案生成失败，请重试", envelope.error?.code);
        const data = envelope.data;
        if (!data.proposalId || !data.proposalToken || !data.changes) {
          toast.message(data.summary ?? "没有可自动修复的问题");
          return;
        }
        setTrustDiff(data.changes);
        setTrustRemote({ tripId: trip.id, proposalId: data.proposalId, baseRevision: data.baseRevision, proposalToken: data.proposalToken });
        setTrustDiffOpen(true);
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") {
          toast.error("行程已在别处更新，已同步最新版本，请重试");
          void resyncTrip(trip.id);
          return;
        }
        toast.error(cause instanceof ApiError ? cause.message : "修复方案生成失败，请重试");
      } finally {
        setTrustBusy(false);
      }
    })();
  };

  const applyTrustRepair = () => {
    void (async () => {
      if (!trustRemote) {
        toast.error("方案已过期，请重新生成");
        return;
      }
      const envelope = await postEnvelope<{ trip?: Trip; revision?: number }>("/api/voyage/replan/apply", {
        ...trustRemote,
        confirmed: true,
      });
      if (!envelope.ok || !envelope.data?.trip) {
        toast.error(envelope.error?.message ?? "方案已过期，请重新生成");
        return;
      }
      pushHistory(trip);
      setTrip(envelope.data.trip, envelope.data.revision ?? trustRemote.baseRevision + 1);
      toast.success("已应用修复方案，可随时撤销");
    })().catch((cause) => {
      console.warn("voyage: trust replan apply failed", cause);
      toast.error(cause instanceof ApiError ? cause.message : "应用修改失败，请重试");
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-12 items-center px-3">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            const next = v as WorkspaceTab;
            setTab(next);
            if (next === "explore") router.push(`/trip/${trip.id}/explore`);
            if (next === "book") router.push(`/trip/${trip.id}/offers`);
            if (next === "tasks") router.push(`/trip/${trip.id}`);
            if (next === "itinerary") router.push(`/trip/${trip.id}`);
          }}
        >
          <TabsList>
            <TabsTrigger value="itinerary">行程</TabsTrigger>
            <TabsTrigger value="explore">探索</TabsTrigger>
            <TabsTrigger value="book">推荐</TabsTrigger>
            <TabsTrigger value="tasks">任务</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="border-b border-border px-3 pb-2.5">
        <DayTabs />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {tab === "tasks" ? (
          <TaskList />
        ) : (
          <>
            {focusedDay ? <DayFocusCard day={focusedDay} className="px-4 pt-3" /> : null}
            <SocialEvidencePanel
              evidence={trip.socialEvidence}
              warnings={trip.socialWarnings}
              platformStatus={trip.socialPlatformStatus}
              queryStatus={trip.socialQueryStatus}
              planningMetadata={trip.planningMetadata}
            />
            {trust ? (
              <section className="mx-3 mb-3 rounded-[10px] border border-border bg-background px-3 py-2.5" aria-label="行程可信度校验">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium">
                    {trust.validation.passed ? <ShieldCheck className="size-3.5 text-emerald-600" /> : <TriangleAlert className="size-3.5 text-amber-600" />}
                    <span>行程校验 {trust.validation.score} 分</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Link
                      href={`/trip/${encodeURIComponent(trip.id)}/evidence`}
                      className="underline-offset-2 hover:text-primary hover:underline"
                    >
                      证据 {trust.evidence.length} 条
                    </Link>
                    <span aria-hidden="true">·</span>
                    <Link
                      href={`/trip/${encodeURIComponent(trip.id)}/insights`}
                      className="underline-offset-2 hover:text-primary hover:underline"
                    >
                      运营视角
                    </Link>
                  </span>
                </div>
                {trustErrors.length || trustWarnings.length ? (
                  <div className="mt-1 space-y-0.5 text-[11px] leading-4 text-muted-foreground">
                    <p>{trustErrors.length ? `需处理 ${trustErrors.length} 个问题` : "无硬性冲突"}{trustWarnings.length ? `，${trustWarnings.length} 个提醒` : ""}</p>
                    {[...trustErrors, ...trustWarnings].slice(0, 4).map((issue, index) => (
                      <p key={`${issue.code}-${issue.itemId ?? issue.dayId ?? index}`} className={issue.severity === "error" ? "text-red-600" : "text-amber-700"}>· {issue.message}</p>
                    ))}
                  </div>
                ) : <p className="mt-1 text-[11px] text-muted-foreground">地点来源、路线与安排已完成基础核验</p>}
                {trust.validation.issues.length ? (
                  <button
                    type="button"
                    onClick={requestTrustRepair}
                    disabled={trustBusy}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
                  >
                    {trustBusy ? <LoaderCircle className="size-3 animate-spin" /> : <WandSparkles className="size-3" />}
                    {trustBusy ? "正在生成方案…" : "一键修复可自动处理的问题"}
                  </button>
                ) : null}
              </section>
            ) : null}
            <motion.div
              key={activeDayId ?? "all"}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {visibleDays.map((day) => (
                <DayTimeline key={day.id} day={day} />
              ))}
            </motion.div>
          </>
        )}
      </div>
      <TripDiffModal
        changeSet={trustDiff}
        open={trustDiffOpen}
        onOpenChange={setTrustDiffOpen}
        onApply={() => applyTrustRepair()}
        title="行程修复建议"
        subtitle="仅使用当前候选地点修复可自动处理的校验问题，确认后才会写入行程；应用后可随时撤销。"
      />
    </div>
  );
}
