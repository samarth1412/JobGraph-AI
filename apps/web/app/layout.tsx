import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "JobGraph AI",
  description: "Agentic job-search copilot",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
