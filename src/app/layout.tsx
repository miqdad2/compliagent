import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompliAgent",
  description: "AI technical compliance review system for engineering document reviews."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
