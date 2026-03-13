import { PublicKey, Connection, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { create, mplCore } from "@metaplex-foundation/mpl-core";
import {
  generateSigner,
  publicKey as umiPublicKey,
  transactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { setComputeUnitPrice } from "@metaplex-foundation/mpl-toolbox";
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

function getRecordType(): Record {
  return Record.TXT;
}

/**
 * Check if domain already has an agent_core TXT record.
 * Returns the existing Core Asset pubkey if found, null otherwise.
 */
async function getExistingAgent(
  connection: Connection,
  domainName: string
): Promise<string | null> {
  try {
    const recordKey = getRecordV2Key(domainName, Record.TXT);
    const recordInfo = await connection.getAccountInfo(recordKey);
    if (!recordInfo || !recordInfo.data) return null;

    // Try to read UTF-8 content from the record data
    const content = Buffer.from(recordInfo.data).toString("utf-8");
    const match = content.match(/agent_core=([A-Za-z0-9]{32,44})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ---------- Core Function ----------

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

  callbacks?.onStep(
    "validate",
    `Ownership verified: ${domainName}.sol belongs to ${owner.toBase58().slice(0, 6)}...`
  );

  // --- Check if agent already exists ---
  callbacks?.onStep("check", `Checking for existing agent on ${domainName}.sol`);
  const existingAgent = await getExistingAgent(connection, domainName);
  if (existingAgent) {
    throw new Error(
      `${domainName}.sol already has an agent.\n` +
      `Existing Core Asset: ${existingAgent}\n` +
      `To create a new agent, first remove the existing TXT record.`
    );
  }
  callbacks?.onStep("check", "No existing agent found, proceeding");

  // --- Step 1: Initialize Umi ---
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
    throw new Error(`Irys upload failed: ${e.message}. Ensure your wallet has SOL for Irys storage fees.`);
  }
  callbacks?.onStep("metadata", `Metadata uploaded: ${metadataUri}`);

  // --- Step 3: Create Metaplex Core Asset (with priority fee) ---
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

    // Prepend priority fee instruction
    const tx = setComputeUnitPrice(umi, { microLamports: 50_000 }).add(builder);

    const result = await tx.sendAndConfirm(umi, {
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
  callbacks?.onStep("sns-record", "Setting SNS Records V2 (agent_core)");
  const recordContent = `agent_core=${coreAssetPubkey.toBase58()}`;
  const recordType = getRecordType();
  let snsRecordTxSig: string;

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

  callbacks?.onStep("done", "Domain upgraded to Agent successfully!");

  return {
    coreAssetPubkey: coreAssetPubkey.toBase58(),
    metadataUri,
    snsRecordTxSig,
    coreAssetTxSig,
  };
}
