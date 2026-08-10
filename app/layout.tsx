import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "航标 · 家庭仓库",
  description: "家庭物品、容器与装载架的只读仓库管理视图。",
  openGraph: {
    title: "航标 · 家庭仓库",
    description: "家的每一件东西，都有清晰坐标。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "航标家庭仓库" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "航标 · 家庭仓库",
    description: "家的每一件东西，都有清晰坐标。",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
