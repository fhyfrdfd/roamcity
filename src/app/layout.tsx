import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { brand } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: `${brand.name} · ${brand.product}`,
  description: brand.description,
};

export const viewport: Viewport = {
  // Required for env(safe-area-inset-*) to resolve on iOS; without it the
  // bottom tab bar's safe-area padding is always zero.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f14" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
