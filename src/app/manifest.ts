import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "漫游城事 · 智慧旅行规划平台",
    short_name: "漫游城事",
    description: "以真实地点和城市交通为依据的旅行规划平台",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#0f766e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
