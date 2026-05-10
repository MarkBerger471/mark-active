import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
import BackgroundEffects from "@/components/BackgroundEffects";
import PWAProvider from "@/components/PWAProvider";
import PageTransition from "@/components/PageTransition";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mark Active | Body Tracker",
  description: "Track your bodybuilding progress",
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mark Active',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen">
        <div className="boot-splash" aria-hidden="true">
          <div className="boot-splash-mark">
            <svg viewBox="0 0 32 32" width="36" height="36" fill="currentColor">
              <rect x="4" y="12" width="4" height="8" rx="1" opacity="0.8" />
              <rect x="24" y="12" width="4" height="8" rx="1" opacity="0.8" />
              <rect x="2" y="13.5" width="3" height="5" rx="1" opacity="0.6" />
              <rect x="27" y="13.5" width="3" height="5" rx="1" opacity="0.6" />
              <rect x="8" y="15" width="16" height="2" rx="1" />
            </svg>
          </div>
        </div>
        <BackgroundEffects />
        <PWAProvider />
        <AuthProvider><PageTransition>{children}</PageTransition></AuthProvider>
      </body>
    </html>
  );
}
