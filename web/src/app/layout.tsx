import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ops Orchestrator",
  description: "Internal access & workflow automation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#f4f4f1] text-gray-900 antialiased font-dm-sans">{children}</body>
    </html>
  );
}
