import { describe, expect, it } from "vitest";
import { getScene, isKnownScene, listScenes, sceneForPlace } from "@/services/3d/scenes";

describe("3D scene registry", () => {
  it("maps a known POI only inside its city", () => {
    expect(sceneForPlace("重庆", "洪崖洞")).toBe("chongqing-hongyadong");
    expect(sceneForPlace("重庆市渝中区", "洪崖洞民俗风貌区")).toBe("chongqing-hongyadong");
    expect(sceneForPlace("成都", "洪崖洞")).toBeUndefined();
    expect(sceneForPlace("重庆", "解放碑")).toBeUndefined();
    expect(sceneForPlace("", "洪崖洞")).toBeUndefined();
  });

  it("rejects unknown scene ids instead of resolving arbitrary paths", () => {
    expect(isKnownScene("chongqing-hongyadong")).toBe(true);
    expect(isKnownScene("../../etc/passwd")).toBe(false);
    expect(getScene("../../etc/passwd")).toBeUndefined();
  });

  it("exposes scene metadata for the page and license notice", () => {
    const scenes = listScenes();
    expect(scenes.length).toBeGreaterThan(1);
    const scene = getScene(scenes[0].id);
    expect(scene?.title).toContain("洪崖洞");
    expect(scene?.model).toContain("/3d/scenes/");
    expect(scene?.license).toContain("CC0");
    expect(scene?.format).toBe("glb");
  });

  it("offers the CC-BY 3DGS sample without binding it to a trip place", () => {
    const splat = getScene("knock-community-hall");
    expect(splat).toMatchObject({
      format: "splat",
      model: "/3d/splats/knock-community-hall.sog",
      license: "CC-BY-4.0",
    });
    expect(sceneForPlace("重庆", "Knock Community Hall")).toBeUndefined();
    expect(sceneForPlace("Knock", "Knock Community Hall")).toBeUndefined();
  });
});
