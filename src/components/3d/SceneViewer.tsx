"use client";

import { useEffect, useRef, useState } from "react";
import type { SceneHotspot } from "@/services/3d/scenes";

type ModelViewerProps = {
  src: string;
  poster: string;
  alt: string;
  className?: string;
  "camera-controls"?: string;
  "auto-rotate"?: string;
  "rotation-per-second"?: string;
  "shadow-intensity"?: string;
  exposure?: string;
  "interaction-prompt"?: string;
  loading?: string;
  reveal?: string;
  ref?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
};

// The custom element is registered by the dynamic import below; the cast keeps
// JSX typed without declaring the tag globally.
const ModelViewer = "model-viewer" as unknown as React.ComponentType<ModelViewerProps>;

export function SceneViewer({
  src,
  poster,
  alt,
  hotspots,
  activeId,
  onSelect,
}: {
  src: string;
  poster: string;
  alt: string;
  hotspots: SceneHotspot[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const [libReady, setLibReady] = useState(false);
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const viewerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@google/model-viewer")
      .then(() => { if (!cancelled) setLibReady(true); })
      .catch(() => { if (!cancelled) setModelState("error"); });
    return () => { cancelled = true; };
  }, []);

  // React's onLoad does not bind to a custom element's load event reliably,
  // so listen directly and also cover the case where the model finished
  // loading before the listener was attached.
  useEffect(() => {
    const element = viewerRef.current;
    if (!libReady || !element) return;
    const handleLoad = () => setModelState("ready");
    const handleError = () => setModelState("error");
    element.addEventListener("load", handleLoad);
    element.addEventListener("error", handleError);
    if ((element as unknown as { loaded?: boolean }).loaded) setModelState("ready");
    return () => {
      element.removeEventListener("load", handleLoad);
      element.removeEventListener("error", handleError);
    };
  }, [libReady]);

  const state = modelState === "error" ? "error" : libReady && modelState === "ready" ? "ready" : "loading";

  return (
    <div
      data-testid="scene-viewer"
      data-state={state}
      className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-stone-900"
    >
      <div
        role="img"
        aria-label={alt}
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${poster})` }}
      />
      {libReady && modelState !== "error" ? (
        <ModelViewer
          ref={viewerRef}
          src={src}
          poster={poster}
          alt={alt}
          className="absolute inset-0 h-full w-full"
          camera-controls=""
          auto-rotate=""
          rotation-per-second="8deg"
          shadow-intensity="1"
          exposure="1"
          interaction-prompt="none"
          loading="eager"
          reveal="auto"
        >
          {hotspots.map((hotspot, index) => (
            <button
              key={hotspot.id}
              type="button"
              slot={`hotspot-${hotspot.id}`}
              data-position={hotspot.position}
              data-normal={hotspot.normal}
              data-testid="scene-hotspot-3d"
              aria-label={hotspot.label}
              aria-pressed={activeId === hotspot.id}
              onClick={() => onSelect(hotspot.id)}
              className={`touch-target grid size-7 place-items-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-lg ${activeId === hotspot.id ? "bg-primary" : "bg-stone-900/80"}`}
            >
              {index + 1}
            </button>
          ))}
        </ModelViewer>
      ) : null}
      {state === "loading" ? (
        <div className="absolute inset-x-0 bottom-0 bg-stone-950/70 px-4 py-3 text-xs text-stone-100">
          正在加载 3D 场景…
        </div>
      ) : null}
      {state === "error" ? (
        <div className="absolute inset-x-0 bottom-0 bg-destructive/90 px-4 py-3 text-xs text-white" role="status">
          3D 模型加载失败，已显示封面。你仍可在右侧查看热点讲解。
        </div>
      ) : null}
    </div>
  );
}
