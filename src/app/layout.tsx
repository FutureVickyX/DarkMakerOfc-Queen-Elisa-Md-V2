import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { RepositoryProvider } from "@/components/RepositoryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NailMeasure", template: "%s · NailMeasure" },
  description: "Calibrated fingernail measurement for custom press-on nail sizing.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <RepositoryProvider>
          <AppShell>{children}</AppShell>
        </RepositoryProvider>
      </body>
    </html>
  );
}
