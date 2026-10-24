import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScenePreviewLink } from "@/components/3d/ScenePreviewLink";

afterEach(cleanup);

describe("ScenePreviewLink", () => {
  it("links a matching stop to the preset scene with its place id", () => {
    render(<ScenePreviewLink destination="重庆" placeName="洪崖洞" placeId="amap-123" />);
    const link = screen.getByTestId("poi-3d-link");
    expect(link).toHaveTextContent("3D 预览");
    expect(link).toHaveAttribute("href", "/3d/chongqing-hongyadong?placeId=amap-123");
  });

  it("does not offer a scene for a same-named place in another city", () => {
    render(<ScenePreviewLink destination="成都" placeName="洪崖洞" placeId="amap-123" />);
    expect(screen.queryByTestId("poi-3d-link")).not.toBeInTheDocument();
  });

  it("does not offer a scene for an unrelated stop", () => {
    render(<ScenePreviewLink destination="重庆" placeName="解放碑" placeId="amap-456" />);
    expect(screen.queryByTestId("poi-3d-link")).not.toBeInTheDocument();
  });
});
