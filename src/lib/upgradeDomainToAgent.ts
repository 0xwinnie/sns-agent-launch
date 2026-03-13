import { PublicKey, Connection, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { create, mplCore } from "@metaplex-foundation/mpl-core";
import {
  generateSigner,
  publicKey as umiPublicKey,
  type Umi,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import {
  createRecordV2Instruction,
  updateRecordV2Instruction,
  getRecordV2Key,
  Record,
  getDomainKeySync,
} from "@bonfida/spl-name-service";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { buildAgentMetadata, RPC_ENDPOINT } from "./constants";

// ---------- Types ----------

export interface UpgradeResult {
  coreAssetPubkey: string;
  metadataUri: string;
  snsRecordTxSig: string;
  coreAssetTxSig: string;
}

export interface UpgradeCallbacks {
  onStep: (step: string, detail?: string) => void;
  onError: (step: string, error: Error) => void;
}

// ---------- Helpers ----------

/** Strip ".sol" suffix if present */
function stripSol(domain: string): string {
  return domain.endsWith(".sol") ? domain.slice(0, -4) : domain;
}

/**
 * Derive the SNS record V2 account for a custom key.
 *
 * For standard records (Github, Email, etc.) use the Record enum.
 * For our custom "agent_core" key we use Record.TXT as the record type
 * and embed the actual key in the content, because the SNS program
 * only supports enum-based record keys in V2 today.
 *
 * When MIP-014 ships, this will be replaced with a native custom-key API.
 */
function getRecordType(): Record {
  // Fallback: use TXT record to store agent_core mapping
  // Content format: "agent_core=<CoreAssetPubkey>"
  return Record.TXT;
}

// ---------- Core Function ----------

/**
 * Upgrade a .sol domain to an on-chain AI Agent identity.
 *
 * Steps:
 * 1. Create Metaplex Core Asset (Agent identity NFT)
 * 2. Upload ERC-8004 JSON metadata via Irys
 * 3. Set SNS Records V2 TXT record with agent_core=<CoreAssetPubkey>
 * 4. Return all signatures + pubkeys for SolanaAgentKit delegation
 */
export async function upgradeDomainToAgent(
  domain: string,
  wallet: WalletContextState,
  connection: Connection,
  callbacks?: UpgradeCallbacks
): Promise<UpgradeResult> {
  const owner = wallet.publicKey;
  if (!owner) throw new Error("Wallet not connected");

  const domainName = stripSol(domain);

  // --- Validate domain existence + ownership ---
  callbacks?.onStep("validate", `Validating ownership of ${domainName}.sol`);

  const { pubkey: domainKey } = getDomainKeySync(domainName);

  // Fetch domain account directly to avoid NameRegistryState parsing issues
  const domainInfo = await connection.getAccountInfo(domainKey);

  if (!domainInfo) {
    throw new Error(
      `Domain "${domainName}.sol" not found on-chain.\n` +
      `Derived key: ${domainKey.toBase58()}\n` +
      `RPC: ${connection.rpcEndpoint.replace(/api-key=.*/, "api-key=***")}`
    );
  }

  // Parse owner from account data: first 32 bytes = parentName, next 32 bytes = owner
  const domainOwner = new PublicKey(domainInfo.data.slice(32, 64));

  if (!domainOwner.equals(owner)) {
    throw new Error(
      `You are not the owner of "${domainName}.sol".\n` +
      `Domain owner: ${domainOwner.toBase58()}\n` +
      `Connected wallet: ${owner.toBase58()}`
    );
  }

  const domainExists = true;
  callbacks?.onStep(
    "validate",
    `Ownership verified: ${domainName}.sol belongs to ${owner.toBase58().slice(0, 6)}...`
  );

  // --- Step 1: Initialize Umi + create Core Asset ---
  callbacks?.onStep("umi", "Initializing Umi with wallet");
  const umi: Umi = createUmi(RPC_ENDPOINT, "confirmed")
    .use(walletAdapterIdentity(wallet))
    .use(mplCore())
    .use(irysUploader());

  // Generate Core Asset signer
  const assetSigner = generateSigner(umi);
  const coreAssetPubkey = toWeb3JsPublicKey(assetSigner.publicKey);

  // --- Step 2: Upload metadata to Irys ---
  callbacks?.onStep("metadata", "Building & uploading Agent metadata via Irys");
  const metadata = buildAgentMetadata(
    `${domainName}.sol`,
    coreAssetPubkey.toBase58()
  );

  let metadataUri: string;
  try {
    metadataUri = await umi.uploader.uploadJson(metadata);
  } catch (e: any) {
    // Irys may need funding — surface a clear message
    throw new Error(`Irys upload failed: ${e.message}. Ensure your wallet has SOL for Irys storage fees.`);
  }
  callbacks?.onStep("metadata", `Metadata uploaded: ${metadataUri}`);

  // --- Step 3: Create Metaplex Core Asset ---
  callbacks?.onStep("core-asset", "Creating Metaplex Core Asset (Agent identity)");
  let coreAssetTxSig: string;
  try {
    const builder = create(umi, {
      asset: assetSigner,
      name: `${domainName}.sol Agent`,
      uri: metadataUri,
      owner: umiPublicKey(owner.toBase58()),
      plugins: [
        {
          type: "Attributes",
          attributeList: [
            { key: "domain", value: `${domainName}.sol` },
            { key: "protocol", value: "agent-core-v1" },
            { key: "agent_version", value: "1.0.0" },
          ],
        },
      ],
    });

    const result = await builder.sendAndConfirm(umi, {
      send: { commitment: "confirmed" },
      confirm: { commitment: "confirmed" },
    });
    coreAssetTxSig = base58.deserialize(result.signature)[0];
  } catch (e: any) {
    throw new Error(`Core Asset creation failed: ${e.message}`);
  }
  callbacks?.onStep(
    "core-asset",
    `Core Asset created: ${coreAssetPubkey.toBase58()} (tx: ${coreAssetTxSig})`
  );

  // --- Step 4: Set SNS Records V2 (TXT = "agent_core=<pubkey>") ---
  const recordContent = `agent_core=${coreAssetPubkey.toBase58()}`;
  let snsRecordTxSig: string;

  if (!domainExists) {
    callbacks?.onStep("sns-record", `Skipping SNS record (domain not found). Would set: ${recordContent}`);
    snsRecordTxSig = "skipped";
  } else {
    callbacks?.onStep("sns-record", "Setting SNS Records V2 (agent_core)");
    const recordType = getRecordType();

    try {
      let ixs;
      try {
        ixs = createRecordV2Instruction(
          domainName,
          recordType,
          recordContent,
          owner,
          owner
        );
      } catch {
        ixs = updateRecordV2Instruction(
          domainName,
          recordType,
          recordContent,
          owner,
          owner
        );
      }

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction();
      // Add priority fee to speed up confirmation on mainnet
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
      );
      tx.add(...(Array.isArray(ixs) ? ixs : [ixs]));
      tx.recentBlockhash = blockhash;
      tx.feePayer = owner;

      snsRecordTxSig = await wallet.sendTransaction(tx, connection, {
        skipPreflight: false,
      });

      await connection.confirmTransaction(
        { signature: snsRecordTxSig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
    } catch (e: any) {
      throw new Error(`SNS record update failed: ${e.message}`);
    }
    callbacks?.onStep(
      "sns-record",
      `Record set: TXT → ${recordContent} (tx: ${snsRecordTxSig})`
    );
  }

  callbacks?.onStep("done", "Domain upgraded to Agent successfully!");

  return {
    coreAssetPubkey: coreAssetPubkey.toBase58(),
    metadataUri,
    snsRecordTxSig,
    coreAssetTxSig,
  };
}
