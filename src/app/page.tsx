"use client";

import dynamic from "next/dynamic";

// Dynamic import to avoid SSR issues with wallet adapter
const AgentUpgradePanel = dynamic(
  () => import("@/components/AgentUpgradePanel"),
  { ssr: false }
);

export default function Home() {
  return (
    <main>
      <AgentUpgradePanel />
    </main>
  );
}
