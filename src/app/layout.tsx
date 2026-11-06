import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";
import { AccountProvider } from "@/components/account/AccountProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BugLab · Debugging Workspace",
  description:
    "Learn software engineering through realistic debugging investigations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The <head> script sets data-theme on <html> before hydration, so React
    // must not treat that attribute as a mismatch (this <html> element only).
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved or system theme before the first paint: no flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground"><AccountProvider>{children}</AccountProvider></body>
    </html>
  );
}
