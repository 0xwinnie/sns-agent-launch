import type { Metadata } from "next";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "SNS Agent Launchpad",
  description:
    "Transform any .sol domain into an on-chain AI Agent identity using Metaplex Core + SNS Records V2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
          background: "#0a0a0a",
          color: "#e0e0e0",
          minHeight: "100vh",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
