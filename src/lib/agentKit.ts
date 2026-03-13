/**
 * SolanaAgentKit integration.
 *
 * This module wraps solana-agent-kit v2 to accept a browser wallet adapter
 * and expose the agent's execute PDA for delegation.
 *
 * In production, the AI backend would hold its own KeypairWallet and
 * the user would delegate authority to its PDA via the Core Asset.
 * Here we demonstrate the wiring so the frontend can show the delegation step.
 */

import {
  PublicKey,
  type Transaction,
  type VersionedTransaction,
  type SendOptions,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { RPC_ENDPOINT } from "./constants";

/**
 * Adapter: convert @solana/wallet-adapter-react's WalletContextState
 * into solana-agent-kit v2's BaseWallet interface.
 */
export function toAgentWallet(wallet: WalletContextState) {
  if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions || !wallet.signMessage) {
    throw new Error("Wallet must be fully connected with signing capabilities");
  }

  return {
    publicKey: wallet.publicKey,

    signTransaction: <T extends Transaction | VersionedTransaction>(
      tx: T
    ): Promise<T> => wallet.signTransaction!(tx),

    signAllTransactions: <T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> => wallet.signAllTransactions!(txs),

    signMessage: (message: Uint8Array): Promise<Uint8Array> =>
      wallet.signMessage!(message),

    signAndSendTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T,
      _options?: SendOptions
    ): Promise<{ signature: string }> => {
      const sig = await wallet.sendTransaction(tx as any, (wallet as any).connection);
      return { signature: sig };
    },
  };
}

/**
 * Create a SolanaAgentKit instance from a connected wallet.
 *
 * Usage:
 *   const agent = await createAgent(wallet);
 *   // agent.methods.* now has all plugin methods
 *   // agent.wallet.publicKey is the Execute PDA owner
 */
export async function createAgent(wallet: WalletContextState) {
  // Dynamic import to avoid SSR issues (solana-agent-kit uses Node APIs)
  const { SolanaAgentKit } = await import("solana-agent-kit");

  const agentWallet = toAgentWallet(wallet);

  const agent = new SolanaAgentKit(agentWallet, RPC_ENDPOINT, {});

  // Optionally load plugins:
  // const MiscPlugin = (await import("@solana-agent-kit/plugin-misc")).default;
  // agent.use(MiscPlugin);

  return agent;
}

/**
 * Get the "execute PDA" for an agent — this is the address that
 * the AI can use to execute transactions on behalf of the domain owner.
 *
 * In the real MIP-014 flow, this would be a PDA derived from the
 * Core Asset. For now, it's simply the agent wallet's public key.
 */
export function getExecutePDA(agentWalletPubkey: PublicKey): PublicKey {
  // Placeholder: in MIP-014, this would be:
  // PublicKey.findProgramAddressSync(
  //   [Buffer.from("execute"), coreAsset.toBuffer()],
  //   AGENT_PROGRAM_ID
  // )[0];
  return agentWalletPubkey;
}
