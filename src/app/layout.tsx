import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import FreezeBanner from "@/components/FreezeBanner";
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
  title: "Keeper Central | Football Friends",
  description: "Keeper valuation, 2027 ADP projections, and trade evaluator dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        <FreezeBanner />
        <div className="flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
