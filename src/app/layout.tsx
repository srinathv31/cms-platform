import type { Metadata } from "next";
import "./globals.css";
import { fontVariables } from "@/styles/fonts";
import { Providers } from "@/components/motion/providers";

export const metadata: Metadata = {
  title: { default: "UCOMP", template: "%s · UCOMP" },
  description: "Author, approve and publish customer content.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
