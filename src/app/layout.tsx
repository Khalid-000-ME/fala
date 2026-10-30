import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Fala — your agent asks, you reply from Gmail",
  description:
    "AI agents spend small amounts on their own. For anything bigger they email you — reply from Gmail and Arc verifies Google's signature before any USDC moves.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
