import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `设置 · 漫游城事`,
};

export default function SettingsTitleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
