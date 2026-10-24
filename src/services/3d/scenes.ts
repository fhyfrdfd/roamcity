import hongyadong from "../../../public/3d/scenes/chongqing-hongyadong/scene.json";
import knockCommunityHall from "../../../public/3d/scenes/knock-community-hall/scene.json";

export type SceneFormat = "glb" | "splat";

export interface SceneDefinition {
  id: string;
  title: string;
  city: string;
  placeNames: string[];
  model: string;
  cover: string;
  license: string;
  source: string;
  /** glb renders through <model-viewer>; splat renders through the vendored SuperSplat viewer. */
  format: SceneFormat;
}

export interface SceneHotspot {
  id: string;
  label: string;
  /** model-viewer hotspot position in model space ("x y z"). */
  position: string;
  normal: string;
  description: string;
}

const SCENES: readonly SceneDefinition[] = [
  {
    id: hongyadong.id,
    title: hongyadong.title,
    city: hongyadong.city,
    placeNames: hongyadong.placeNames,
    model: hongyadong.model,
    cover: hongyadong.cover,
    license: hongyadong.license,
    source: hongyadong.source,
    format: "glb",
  },
  {
    id: knockCommunityHall.id,
    title: knockCommunityHall.title,
    city: knockCommunityHall.city,
    placeNames: knockCommunityHall.placeNames,
    model: knockCommunityHall.model,
    cover: knockCommunityHall.cover,
    license: knockCommunityHall.license,
    source: knockCommunityHall.source,
    format: "splat",
  },
];

export function listScenes(): readonly SceneDefinition[] {
  return SCENES;
}

export function getScene(sceneId: string): SceneDefinition | undefined {
  return SCENES.find((scene) => scene.id === sceneId);
}

export function isKnownScene(sceneId: string): boolean {
  return Boolean(getScene(sceneId));
}

/**
 * Maps a trip stop to a prebuilt 3D scene. The scene is only offered when the
 * destination and the place name both match, so a same-named place in another
 * city never opens the wrong scene.
 */
export function sceneForPlace(destination: string, placeName: string): string | undefined {
  const city = destination.trim();
  const name = placeName.trim();
  if (!city || !name) return undefined;
  const match = SCENES.find((scene) => {
    if (scene.placeNames.length === 0) return false;
    const cityMatches = city.includes(scene.city) || scene.city.includes(city);
    const nameMatches = scene.placeNames.some((candidate) => name.includes(candidate) || candidate.includes(name));
    return cityMatches && nameMatches;
  });
  return match?.id;
}
