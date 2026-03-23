import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
import BackgroundEffects from "@/components/BackgroundEffects";
import PWAProvider from "@/components/PWAProvider";
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
  title: "Mark Active | Body Tracker",
  description: "Track your bodybuilding progress",
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mark Active',
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen">
        <BackgroundEffects />
        <PWAProvider />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
