import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Fala",
  description:
    "Approve your AI agent's payments from Gmail. Your agent emails you, you reply, and Arc verifies it before any money moves.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("fala-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}` }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
