/**
 * Agent Actions — MVP on-chain operations for the Agent Console.
 *
 * Supports:
 * - SOL transfer
 * - SPL token transfer
 * - Jupiter swap (via API)
 * - Balance check
 */

import {
  PublicKey,
  Connection,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { RPC_ENDPOINT } from "./constants";

const IS_DEVNET = RPC_ENDPOINT.includes("devnet");

// ---------- Types ----------

export interface ActionResult {
  success: boolean;
  message: string;
  txSig?: string;
}

// Jupiter API (works on mainnet; devnet has limited support)
const JUPITER_QUOTE_API = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API = "https://api.jup.ag/swap/v1/swap";

// Well-known mints
const SOL_MINT = "So11111111111111111111111111111111111111112";
const KNOWN_TOKENS: Record<string, string> = {
  SOL: SOL_MINT,
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

// ---------- Command Parser ----------

export interface ParsedCommand {
  action: "transfer" | "swap" | "balance" | "help" | "unknown";
  amount?: number;
  token?: string;
  toToken?: string;
  recipient?: string;
  raw: string;
}

export function parseCommand(input: string): ParsedCommand {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  // Help
  if (lower === "help" || lower === "/help") {
    return { action: "help", raw };
  }

  // Balance
  if (lower === "balance" || lower.startsWith("check balance") || lower === "/balance") {
    return { action: "balance", raw };
  }

  // Transfer: "transfer 0.1 SOL to <address>"
  const transferMatch = lower.match(
    /(?:transfer|send)\s+([\d.]+)\s+(\w+)\s+to\s+([a-z0-9]+)/i
  );
  if (transferMatch) {
    return {
      action: "transfer",
      amount: parseFloat(transferMatch[1]),
      token: transferMatch[2].toUpperCase(),
      recipient: raw.match(/to\s+([A-Za-z0-9]+)/i)?.[1] || transferMatch[3],
      raw,
    };
  }

  // Swap: "swap 0.1 SOL to USDC" or "swap 0.1 SOL for USDC"
  const swapMatch = lower.match(
    /swap\s+([\d.]+)\s+(\w+)\s+(?:to|for)\s+(\w+)/i
  );
  if (swapMatch) {
    return {
      action: "swap",
      amount: parseFloat(swapMatch[1]),
      token: swapMatch[2].toUpperCase(),
      toToken: swapMatch[3].toUpperCase(),
      raw,
    };
  }

  return { action: "unknown", raw };
}

// ---------- Actions ----------

/**
 * Get SOL balance
 */
export async function getBalance(
  connection: Connection,
  owner: PublicKey
): Promise<ActionResult> {
  const balance = await connection.getBalance(owner);
  const sol = balance / LAMPORTS_PER_SOL;
  return {
    success: true,
    message: `Balance: ${sol.toFixed(4)} SOL`,
  };
}

/**
 * Transfer SOL to a recipient
 */
export async function transferSOL(
  wallet: WalletContextState,
  connection: Connection,
  amount: number,
  recipient: string
): Promise<ActionResult> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(recipient);
  } catch {
    return { success: false, message: `Invalid recipient address: ${recipient}` };
  }

  const lamports = Math.round(amount * LAMPORTS_PER_SOL);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipientPubkey,
      lamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  const sig = await wallet.sendTransaction(tx, connection, {
    skipPreflight: false,
  });

  await connection.confirmTransaction(sig, "confirmed");

  return {
    success: true,
    message: `Transferred ${amount} SOL to ${recipient.slice(0, 6)}...${recipient.slice(-4)}`,
    txSig: sig,
  };
}

/**
 * Swap tokens via Jupiter API
 */
export async function swapTokens(
  wallet: WalletContextState,
  connection: Connection,
  amount: number,
  fromToken: string,
  toToken: string
): Promise<ActionResult> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");

  const inputMint = KNOWN_TOKENS[fromToken] || fromToken;
  const outputMint = KNOWN_TOKENS[toToken] || toToken;

  if (!inputMint) return { success: false, message: `Unknown token: ${fromToken}` };
  if (!outputMint) return { success: false, message: `Unknown token: ${toToken}` };

  if (IS_DEVNET) {
    return {
      success: false,
      message: "Jupiter swap is only available on mainnet (no devnet liquidity pools).\nSwitch to mainnet to test swaps. Transfer and balance work on devnet.",
    };
  }

  // Convert amount to smallest unit (assumes SOL = 9 decimals, others = 6)
  const decimals = fromToken === "SOL" ? 9 : 6;
  const amountInSmallest = Math.round(amount * 10 ** decimals);

  // 1. Get quote
  const quoteUrl = `${JUPITER_QUOTE_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallest}&slippageBps=50`;

  const quoteRes = await fetch(quoteUrl);
  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    return { success: false, message: `Jupiter quote failed: ${errText}` };
  }
  const quote = await quoteRes.json();

  // Format output amount for display
  const outDecimals = toToken === "SOL" ? 9 : 6;
  const outAmount = Number(quote.outAmount) / 10 ** outDecimals;

  // 2. Get swap transaction
  const swapRes = await fetch(JUPITER_SWAP_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
    }),
  });

  if (!swapRes.ok) {
    const errText = await swapRes.text();
    return { success: false, message: `Jupiter swap failed: ${errText}` };
  }

  const swapData = await swapRes.json();

  // 3. Deserialize and send transaction
  const swapTxBuf = Buffer.from(swapData.swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(swapTxBuf);

  const sig = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction(sig, "confirmed");

  return {
    success: true,
    message: `Swapped ${amount} ${fromToken} → ${outAmount.toFixed(4)} ${toToken}`,
    txSig: sig,
  };
}

/**
 * Execute a parsed command
 */
export async function executeCommand(
  cmd: ParsedCommand,
  wallet: WalletContextState,
  connection: Connection
): Promise<ActionResult> {
  switch (cmd.action) {
    case "help":
      return {
        success: true,
        message: [
          "Available commands:",
          "  balance — Check SOL balance",
          "  transfer <amount> SOL to <address> — Send SOL",
          "  swap <amount> <TOKEN> to <TOKEN> — Swap via Jupiter",
          "",
          "Examples:",
          "  transfer 0.01 SOL to 3Sy76...ReXE",
          "  swap 0.1 SOL to USDC",
          "",
          "Supported tokens: SOL, USDC, USDT, BONK",
          ...(IS_DEVNET
            ? ["", "⚠ Devnet mode: swap unavailable (Jupiter = mainnet only). Transfer & balance work."]
            : []),
        ].join("\n"),
      };

    case "balance":
      if (!wallet.publicKey) return { success: false, message: "Wallet not connected" };
      return getBalance(connection, wallet.publicKey);

    case "transfer":
      if (!cmd.amount || !cmd.recipient) {
        return { success: false, message: "Usage: transfer <amount> SOL to <address>" };
      }
      if (cmd.token !== "SOL") {
        return { success: false, message: "Only SOL transfers supported in MVP. Try: transfer 0.01 SOL to <address>" };
      }
      return transferSOL(wallet, connection, cmd.amount, cmd.recipient);

    case "swap":
      if (!cmd.amount || !cmd.token || !cmd.toToken) {
        return { success: false, message: "Usage: swap <amount> <TOKEN> to <TOKEN>" };
      }
      return swapTokens(wallet, connection, cmd.amount, cmd.token, cmd.toToken);

    case "unknown":
    default:
      return {
        success: false,
        message: `I don't understand "${cmd.raw}". Type "help" for available commands.`,
      };
  }
}
