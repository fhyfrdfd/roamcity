"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Box, Info, MapPin } from "lucide-react";
import { SceneViewer } from "./SceneViewer";
import { GuideAvatar } from "./GuideAvatar";
import { Button } from "@/components/ui/button";
import type { SceneDefinition, SceneHotspot } from "@/services/3d/scenes";

type PointerMode = "pending" | "coarse" | "fine";

export function SceneExperience({
  scene,
  narration,
  hotspots,
}: {
  scene: SceneDefinition;
  narration: string;
  hotspots: SceneHotspot[];
}) {
  const [activeId, setActiveId] = useState(hotspots[0]?.id);
  const [pointerMode, setPointerMode] = useState<PointerMode>("pending");
  const [splatEnabled, setSplatEnabled] = useState(false);
  const [splatReady, setSplatReady] = useState(false);
  const [splatTimedOut, setSplatTimedOut] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const active = hotspots.find((hotspot) => hotspot.id === activeId);
  const isSplat = scene.format === "splat";
  const splatSrc = `/3d/viewer/index.html?content=${encodeURIComponent(scene.model)}&poster=${encodeURIComponent(scene.cover)}&lang=zh-CN`;

  // Phones must not start the ~28 MB splat download until the user asks for
  // it; "pending" keeps the iframe out of the DOM during hydration.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setPointerMode("fine");
      return;
    }
    const query = window.matchMedia("(pointer: coarse), (hover: none)");
    const apply = () =>
      setPointerMode(query.matches || navigator.maxTouchPoints > 0 ? "coarse" : "fine");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const showSplat = isSplat && (pointerMode === "fine" || splatEnabled);

  useEffect(() => {
    if (!showSplat) return;
    setSplatReady(false);
    setSplatTimedOut(false);
    const started = Date.now();
    const timer = window.setInterval(() => {
      try {
        if (frameRef.current?.contentDocument?.querySelector("canvas")) {
          setSplatReady(true);
          window.clearInterval(timer);
          return;
        }
      } catch {
        // Cross-origin viewer documents cannot be introspected; fall through
        // to the timeout so the static-cover escape hatch still appears.
      }
      if (Date.now() - started > 30_000) {
        setSplatTimedOut(true);
        window.clearInterval(timer);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [showSplat]);

  const coverStyle = { backgroundImage: `url(${scene.cover})` };

  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b border-border bg-surface px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/trips" className="touch-target inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3" /> 返回行程
            </Link>
            <h1 className="mt-2 text-xl font-semibold md:text-2xl">{scene.title}</h1>
            <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" /> {scene.city} · {isSplat ? "3DGS 示例" : "预置场景演示"}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
            <Box className="size-3" /> {isSplat ? "3DGS · 预置扫描" : "方案 A · 预置 GLB"}
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-[minmax(0,1fr)_360px] md:p-8">
        <section aria-label="3D 场景">
          {isSplat ? (
            <div className="relative overflow-hidden rounded-2xl border border-border bg-black">
              <div className="absolute inset-0 bg-cover bg-center opacity-60" style={coverStyle} aria-hidden="true" />
              {showSplat ? (
                <iframe
                  ref={frameRef}
                  data-testid="splat-viewer"
                  title={`${scene.title} 3DGS 场景`}
                  src={splatSrc}
                  className="relative h-[60vh] min-h-[360px] w-full bg-transparent"
                  allow="fullscreen; xr-spatial-tracking"
                />
              ) : pointerMode === "coarse" ? (
                <div
                  data-testid="splat-gate"
                  className="relative flex h-[60vh] min-h-[360px] flex-col items-center justify-center gap-3 p-6 text-center"
                >
                  <p className="text-sm font-semibold text-white">3DGS 场景约 28 MB</p>
                  <p className="max-w-xs text-xs leading-5 text-white/75">
                    移动网络下先显示静态封面；确认后再加载可旋转的 3D 场景，避免首屏流量与等待。
                  </p>
                  <Button type="button" size="sm" data-testid="splat-load" onClick={() => setSplatEnabled(true)}>
                    加载 3D 场景
                  </Button>
                </div>
              ) : (
                <div className="relative flex h-[60vh] min-h-[360px] items-center justify-center text-xs text-white/75" role="status">
                  正在准备 3DGS 场景…
                </div>
              )}
              {showSplat ? (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2">
                  {!splatReady ? (
                    <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white" role="status">
                      {splatTimedOut ? "加载超时，可切换静态封面或刷新重试" : "正在加载 3DGS 场景…"}
                    </span>
                  ) : (
                    <span />
                  )}
                  {pointerMode === "coarse" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSplatEnabled(false);
                        setSplatReady(false);
                        setSplatTimedOut(false);
                      }}
                      className="pointer-events-auto rounded-full bg-black/60 px-3 py-1.5 text-[11px] text-white"
                    >
                      切换静态封面
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <SceneViewer
              src={scene.model}
              poster={scene.cover}
              alt={`${scene.title} 3D 场景`}
              hotspots={hotspots}
              activeId={activeId}
              onSelect={setActiveId}
            />
          )}
          <p data-testid="scene-license" className="mt-2 inline-flex max-w-full items-start gap-1 break-words text-[11px] leading-4 text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            来源：{scene.source} · 许可证：{scene.license}
          </p>
          {isSplat ? (
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              查看器：SuperSplat Viewer（MIT，本地托管）· 场景文件约 28 MB，首次加载需要下载；拖动旋转、滚轮缩放。
            </p>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section aria-label="场景讲解" className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">场景讲解</h2>
            <GuideAvatar
              className="mt-3"
              message={
                active
                  ? `正在讲解「${active.label}」，细节见下方热点。`
                  : isSplat
                    ? "这是一个公开扫描的 3DGS 示例场景。"
                    : "点一个热点，我来讲解这里的故事。"
              }
            />
            <p data-testid="scene-narration" className="mt-3 whitespace-pre-line break-words text-[13px] leading-6 text-muted-foreground">
              {narration}
            </p>
          </section>

          <section aria-label="场景热点" className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">场景热点</h2>
            {hotspots.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {hotspots.map((hotspot, index) => (
                  <button
                    key={hotspot.id}
                    type="button"
                    data-testid="scene-hotspot"
                    aria-pressed={activeId === hotspot.id}
                    onClick={() => setActiveId(hotspot.id)}
                    className={`touch-target inline-flex min-h-11 items-center gap-1 rounded-full border px-3 py-1.5 text-xs sm:min-h-0 sm:px-2.5 sm:py-1 ${activeId === hotspot.id ? "border-primary bg-accent text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                  >
                    <span className="grid size-4 place-items-center rounded-full bg-primary text-[9px] font-semibold text-white">{index + 1}</span>
                    {hotspot.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">这个 3DGS 示例没有配置热点；讲解与来源见本页。</p>
            )}
            {active ? (
              <p data-testid="hotspot-detail" className="mt-3 border-l-2 border-primary/40 pl-3 text-[13px] leading-6 text-foreground">
                {active.description}
              </p>
            ) : null}
          </section>

          <p className="text-[11px] leading-4 text-muted-foreground">
            {isSplat
              ? "该场景是公开 3DGS 扫描，不是团队自采、训练或测绘，也不代表任何行程地点的实时状态。"
              : "这是演示用占位场景，不是真实测绘或 3DGS 重建；正式演示前可替换为有明确许可证的 GLB 模型。WebGL 不可用时会自动降级为封面图。"}
          </p>
          <p className="text-[11px] leading-4">
            {isSplat ? (
              <Link href="/3d/chongqing-hongyadong" className="text-primary underline underline-offset-2">返回洪崖洞 GLB 场景</Link>
            ) : (
              <Link href="/3d/knock-community-hall" className="text-primary underline underline-offset-2">查看 3DGS 示例场景</Link>
            )}
          </p>
        </aside>
      </div>
    </main>
  );
}
