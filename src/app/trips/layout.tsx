import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `我的旅行 · 漫游城事`,
};

export default function TripsTitleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
