import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font - no runtime request to Google, which
// matters for an on-premise or CSP-restricted deployment.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "workPulse | SIHL",
  description: "SIHL Work Management Platform",
};

/**
 * Applied before first paint so a stored dark preference does not flash light.
 * Mirrors the three states in globals.css: an explicit choice stamps a class,
 * "system" stamps nothing and lets the media query decide.
 */
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('workpulse-theme');
    if (t === 'dark' || t === 'light') document.documentElement.classList.add(t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
