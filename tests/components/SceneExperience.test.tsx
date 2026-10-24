import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneExperience } from "@/components/3d/SceneExperience";
import { getScene, type SceneHotspot } from "@/services/3d/scenes";

vi.mock("@/components/3d/SceneViewer", () => ({
  SceneViewer: () => <div data-testid="scene-viewer" data-state="ready" />,
}));

afterEach(cleanup);

const scene = getScene("chongqing-hongyadong")!;
const hotspots: SceneHotspot[] = [
  { id: "a", label: "吊脚楼", position: "0 1 2", normal: "0 0 1", description: "第一个热点" },
  { id: "b", label: "夜景", position: "0 2 3", normal: "0 0 1", description: "第二个热点" },
  { id: "c", label: "江岸", position: "0 3 4", normal: "0 0 1", description: "第三个热点" },
];

describe("SceneExperience", () => {
  it("shows narration, license notice and the first hotspot by default", () => {
    render(<SceneExperience scene={scene} narration="这里是一段讲解。" hotspots={hotspots} />);
    expect(screen.getByTestId("scene-narration")).toHaveTextContent("这里是一段讲解。");
    expect(screen.getByTestId("hotspot-detail")).toHaveTextContent("第一个热点");
    expect(screen.getByTestId("scene-license")).toHaveTextContent("CC0");
    expect(screen.getByTestId("scene-viewer")).toBeInTheDocument();
  });

  it("switches the detail panel when another hotspot is clicked", () => {
    render(<SceneExperience scene={scene} narration="讲解" hotspots={hotspots} />);
    fireEvent.click(screen.getByRole("button", { name: /夜景/ }));
    expect(screen.getByTestId("hotspot-detail")).toHaveTextContent("第二个热点");
  });

  it("keeps the page usable when a scene has no hotspots", () => {
    render(<SceneExperience scene={scene} narration="讲解" hotspots={[]} />);
    expect(screen.getByTestId("scene-narration")).toBeInTheDocument();
    expect(screen.queryByTestId("hotspot-detail")).not.toBeInTheDocument();
  });

  it("shows a static guide avatar with a text bubble and no audio controls", () => {
    render(<SceneExperience scene={scene} narration="讲解" hotspots={hotspots} />);

    const guide = screen.getByRole("group", { name: "讲解员" });
    expect(guide).toHaveTextContent("小漫");
    expect(guide).toHaveTextContent("正在讲解「吊脚楼」");
    expect(screen.getByAltText("小漫 头像")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /播放|朗读|语音|暂停/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /夜景/ }));
    expect(screen.getByRole("group", { name: "讲解员" })).toHaveTextContent("正在讲解「夜景」");
  });

  it("renders a 3DGS scene through the vendored viewer with attribution", () => {
    const splat = getScene("knock-community-hall")!;
    render(<SceneExperience scene={splat} narration="3DGS 示例" hotspots={[]} />);

    const viewer = screen.getByTestId("splat-viewer");
    expect(viewer.tagName).toBe("IFRAME");
    expect(viewer).toHaveAttribute("src", expect.stringContaining("/3d/viewer/index.html?content="));
    expect(viewer).toHaveAttribute("src", expect.stringContaining(encodeURIComponent("/3d/splats/knock-community-hall.sog")));
    expect(screen.getByTestId("scene-license")).toHaveTextContent("CC-BY-4.0");
    expect(screen.getByText(/SuperSplat Viewer/)).toBeInTheDocument();
    expect(screen.getByText(/没有配置热点/)).toBeInTheDocument();
    expect(screen.queryByTestId("scene-viewer")).not.toBeInTheDocument();
  });
});
