import type { Metadata } from "next";
import "./globals.css";
import "./glass.css";
import "./glass-refinement.css";

export const metadata: Metadata = {
  title: "FANTAMONITOR · CheFantaVitaE10",
  description: "Formazioni, storico delle letture e competizione della tua lega.",
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
    <html lang="it">
      <body className="antialiased">{children}</body>
    </html>
  );
}
