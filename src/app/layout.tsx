import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3-Sensor Infrared Proximity Line-Following Robot",
  description: "PID simulator for a three-sensor infrared proximity line-following robot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
