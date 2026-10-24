"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/brand";
import { ArrowRight, Compass, Navigation, Calendar, Shuffle, Command, MapPin } from "lucide-react";

/** First upcoming Saturday as an absolute date — the planning profile
 * extractor only reads explicit dates (20XX-M-D), so 周末-style prompts
 * would leave the traveller stuck on the departure-date blocker. */
function nextSaturdayIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + (((6 - date.getDay()) % 7 + 7) % 7 || 7));
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const SUGGESTIONS = [
  `${nextSaturdayIso()} 从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路。`,
  `${nextSaturdayIso()} 成都出发自驾川西4天，2人，摄影风景，避开高反。`,
  `${nextSaturdayIso()} 杭州2日慢游，独行，咖啡馆、独立书店与西湖徒步。`,
];

const PILLARS = [
  { icon: Calendar, title: "Plan", desc: "真实高德 POI 与路网规划，生成按天执行的时间轴与预算。" },
  { icon: Compass, title: "Explore", desc: "探索地道火锅、咖啡与文化地标，一键顺路插进行程。" },
  { icon: Shuffle, title: "Adapt", desc: "“太累了 / 下雨了 / 省100”，AI 生成量化 Diff 待你审阅。" },
  { icon: Navigation, title: "Travel", desc: "Today 现场执行模式：下一站、出发倒计时与单手导航。" },
];

export default function LandingPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState(
    () => `${nextSaturdayIso()} 从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路。`,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/new-trip?q=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 console-grid opacity-60" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_18%_0%,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_38%),radial-gradient(circle_at_88%_8%,rgba(79,70,229,0.12),transparent_32%)]" />

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-[8px] bg-primary text-[12px] font-bold text-primary-foreground">
            V
          </span>
          <span>{brand.name}</span>
          <span className="label-mono rounded border border-border bg-surface/70 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">
            OS · BETA
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-[13px]">
          <Link href="/trips" className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground">
            我的旅行
          </Link>
          <Button asChild size="sm" className="h-8">
            <Link href="/new-trip">进入工作台</Link>
          </Button>
        </nav>
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
        <section>
          <p className="label-mono inline-flex items-center gap-2 text-[10px] text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            Travel OS · local-first · verify before you go
          </p>
          <h1 className="mt-4 max-w-2xl text-[2rem] font-semibold leading-[1.12] tracking-tight text-balance sm:text-5xl">
            告诉漫游城事，你想去哪儿。
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted-foreground sm:text-base">
            输入自然语言，生成带真实坐标、路网交通、实时天气与预算的结构化行程；每个推荐都有来源，每次修改都可审阅。
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-7 overflow-hidden rounded-[14px] border border-border bg-surface/85 shadow-[var(--shadow-panel)] backdrop-blur-md transition-colors focus-within:border-primary/50"
          >
            <div className="flex items-center justify-between border-b border-border/70 px-3.5 py-2">
              <span className="label-mono text-[9px] text-muted-foreground">PROMPT INPUT</span>
              <span className="label-mono hidden items-center gap-1 text-[9px] text-muted-foreground sm:inline-flex">
                <Command className="size-3" /> CTRL + ENTER
              </span>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路。"
              className="min-h-28 resize-none rounded-none border-0 bg-transparent p-3.5 text-[15px] leading-relaxed placeholder:text-muted-foreground/60 focus-visible:ring-0"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 text-[11px] text-muted-foreground">
                <span className="label-mono shrink-0 text-[9px]">QUICK</span>
                <button
                  type="button"
                  onClick={() => setPrompt(SUGGESTIONS[0]!)}
                  className="max-w-[190px] truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  桂林 → 重庆 3天
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt(SUGGESTIONS[1]!)}
                  className="max-w-[160px] truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  川西 4天自驾
                </button>
              </div>
              <Button type="submit" className="h-9 gap-1.5 px-4 text-sm font-medium">
                生成完整旅行
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>

          {process.env.NEXT_PUBLIC_VOYAGE_DEMO_MODE === "true" ? (
            <div className="mt-3">
              <Link href="/trip/chongqing-2026" className="text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline">
                不想打字？先看一个示例行程 →
              </Link>
            </div>
          ) : null}
        </section>

        <section aria-label="行程预览示例" className="hidden lg:block">
          <div className="panel-glass overflow-hidden rounded-[14px] border border-border">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
              <span className="label-mono text-[9px] text-muted-foreground">TRIP PREVIEW · CHQ-3D</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] text-primary">
                <span className="size-1.5 rounded-full bg-primary" /> live demo
              </span>
            </div>
            <div className="space-y-3 p-4">
              {[
                { time: "09:30", name: "解放碑步行街", meta: "景点 · 70 min · 4.7" },
                { time: "12:10", name: "较场口小面", meta: "美食 · 60 min · ¥28" },
                { time: "14:00", name: "长江索道", meta: "体验 · 45 min · ¥20" },
                { time: "19:30", name: "洪崖洞夜景", meta: "夜景 · 90 min · 免费" },
              ].map((row, index, all) => (
                <div key={row.time} className="flex gap-3">
                  <div className="flex w-12 shrink-0 flex-col items-end">
                    <span className="label-mono text-[11px] text-foreground">{row.time}</span>
                    {index < all.length - 1 ? <span className="mt-1 h-8 w-px bg-border" /> : null}
                  </div>
                  <div className="min-w-0 flex-1 rounded-lg border border-border/70 bg-background/50 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium">
                      <MapPin className="size-3 text-primary" />
                      {row.name}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{row.meta}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-px border-t border-border/70 bg-border/60 text-center">
              {[
                ["4", "STOPS"],
                ["12.4", "KM"],
                ["¥ 2,130", "EST."],
              ].map(([value, label]) => (
                <div key={label} className="bg-surface px-2 py-2.5">
                  <p className="label-mono text-[13px] text-foreground">{value}</p>
                  <p className="label-mono mt-0.5 text-[8px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-right text-[10px] text-muted-foreground">示意数据 · 真实行程会标注每个来源与估算</p>
        </section>
      </main>

      <section className="relative mx-auto w-full max-w-6xl px-6 pb-10">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((pillar, index) => {
            const Icon = pillar.icon;
            return (
              <div key={pillar.title} className="group rounded-[12px] border border-border bg-surface/70 p-4 backdrop-blur-sm transition-colors hover:border-primary/30">
                <div className="flex items-center justify-between">
                  <span className="label-mono text-[10px] text-muted-foreground">0{index + 1}</span>
                  <Icon className="size-4 text-primary" />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{pillar.title}</h3>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{pillar.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="relative mx-auto flex w-full max-w-6xl flex-col gap-1 border-t border-border/60 px-6 py-5 text-[11px] text-muted-foreground sm:flex-row sm:justify-between">
        <p>{brand.name} · 智慧城市文旅规划</p>
        <p className="label-mono text-[9px]">AMAP · REAL ROUTES · TRAVEL ACTIONS · LOCAL-FIRST</p>
      </footer>
    </div>
  );
}
