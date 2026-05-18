import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipCraft Studio",
  description:
    "Erstellt aus kurzen Videos Transkripte, Headlines und exportierbare Social-Thumbnails.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
