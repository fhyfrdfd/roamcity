"use client";

import Link from "next/link";
import { Box } from "lucide-react";
import { sceneForPlace } from "@/services/3d/scenes";

/** Shows a 3D-preview entry only when the stop has a matching preset scene. */
export function ScenePreviewLink({
  destination,
  placeName,
  placeId,
}: {
  destination: string;
  placeName: string;
  placeId: string;
}) {
  const sceneId = sceneForPlace(destination, placeName);
  if (!sceneId) return null;
  return (
    <Link
      href={`/3d/${sceneId}?placeId=${encodeURIComponent(placeId)}`}
      data-testid="poi-3d-link"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-0.5 rounded-full border border-primary/30 bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary hover:border-primary/60"
    >
      <Box className="size-3" /> 3D 预览
    </Link>
  );
}
