import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `规划一次旅行 · 漫游城事`,
};

export default function NewTripTitleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
