import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="it" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
