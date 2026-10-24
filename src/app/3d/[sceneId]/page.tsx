import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SceneExperience } from "@/components/3d/SceneExperience";
import { getScene, type SceneHotspot } from "@/services/3d/scenes";

export const dynamic = "force-dynamic";

export default async function ScenePage({ params }: { params: Promise<{ sceneId: string }> }) {
  const { sceneId } = await params;
  const scene = getScene(sceneId);
  if (!scene) notFound();

  const sceneDir = path.join(process.cwd(), "public", "3d", "scenes", scene.id);
  const [narration, hotspotsRaw] = await Promise.all([
    readFile(path.join(sceneDir, "narration.md"), "utf8").catch(() => ""),
    readFile(path.join(sceneDir, "hotspots.json"), "utf8").catch(() => '{"hotspots":[]}'),
  ]);
  const parsed = JSON.parse(hotspotsRaw) as { hotspots?: SceneHotspot[] };
  const hotspots = Array.isArray(parsed.hotspots) ? parsed.hotspots : [];

  return <SceneExperience scene={scene} narration={narration.trim()} hotspots={hotspots} />;
}
