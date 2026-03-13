import { PublicKey } from "@solana/web3.js";

// SNS Program
export const NAME_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX"
);

// SNS Records V2 custom key for Agent Core Asset
export const AGENT_CORE_RECORD_KEY = "agent_core";

// Solana RPC — override with NEXT_PUBLIC_RPC_URL env var
export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=dfa9dcc7-65b2-4767-94a7-b84d4a087609";

// Metaplex Core Asset metadata schema (ERC-8004 inspired)
export interface AgentMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<{ trait_type: string; value: string }>;
  properties: {
    agent: {
      version: string;
      domain: string;
      capabilities: string[];
      execute_pda?: string;
    };
  };
}

export function buildAgentMetadata(
  domain: string,
  coreAssetPubkey?: string
): AgentMetadata {
  return {
    name: `${domain} Agent`,
    description: `On-chain AI Agent identity for ${domain}. Powered by Metaplex Core + SNS Records V2.`,
    image: "", // Will be set after upload or left empty
    attributes: [
      { trait_type: "domain", value: domain },
      { trait_type: "protocol", value: "agent-core-v1" },
      { trait_type: "status", value: "active" },
    ],
    properties: {
      agent: {
        version: "1.0.0",
        domain,
        capabilities: ["execute", "sign", "delegate"],
        execute_pda: coreAssetPubkey,
      },
    },
  };
}
