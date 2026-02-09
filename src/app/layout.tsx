import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Plan for Change — UK Government Milestones Dashboard",
  description:
    "Track the UK Government's 6 Plan for Change milestones: KPIs, Whitehall outputs, parliamentary activity, and media commentary.",
  openGraph: {
    title: "Plan for Change — UK Government Milestones Dashboard",
    description:
      "Track the UK Government's 6 Plan for Change milestones: economic growth, housing, NHS, policing, education, and clean energy.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto pt-14 lg:pt-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
