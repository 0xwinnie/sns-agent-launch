"use client";

import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  WalletMultiButton,
  WalletDisconnectButton,
} from "@solana/wallet-adapter-react-ui";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  upgradeDomainToAgent,
  type UpgradeResult,
} from "@/lib/upgradeDomainToAgent";
import AgentConsole from "./AgentConsole";

interface LogEntry {
  step: string;
  detail: string;
  type: "info" | "error" | "success";
  ts: number;
}

export default function AgentUpgradePanel() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { setVisible: setModalVisible } = useWalletModal();
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<UpgradeResult | null>(null);

  const addLog = useCallback(
    (step: string, detail: string, type: LogEntry["type"] = "info") => {
      setLogs((prev) => [...prev, { step, detail, type, ts: Date.now() }]);
    },
    []
  );

  const handleUpgrade = useCallback(async () => {
    if (!wallet.publicKey) return;

    setLoading(true);
    setLogs([]);
    setResult(null);

    try {
      const res = await upgradeDomainToAgent(domain, wallet, connection, {
        onStep: (step, detail) => addLog(step, detail || "", "info"),
        onError: (step, error) => addLog(step, error.message, "error"),
      });

      setResult(res);
      addLog("complete", "All transactions confirmed!", "success");
    } catch (e: any) {
      addLog("fatal", e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [wallet, connection, domain, addLog]);

  const inputDomain = domain.endsWith(".sol") ? domain : `${domain}.sol`;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>SNS Agent Launchpad</h1>
        <p style={styles.subtitle}>
          Upgrade any .sol domain to an on-chain AI Agent identity
        </p>
      </div>

      {/* Wallet */}
      <div style={styles.walletRow}>
        <WalletMultiButton style={styles.walletBtn} />
        {wallet.connected && (
          <WalletDisconnectButton style={styles.disconnectBtn} />
        )}
      </div>
      {wallet.connected && wallet.publicKey && (
        <p style={styles.walletAddr}>
          Connected: {wallet.publicKey.toBase58().slice(0, 6)}...
          {wallet.publicKey.toBase58().slice(-4)}
        </p>
      )}
      {!wallet.connected && (
        <p style={styles.walletHint}>
          Click &quot;Select Wallet&quot; above. Requires Phantom or Solflare
          browser extension.
        </p>
      )}

      {/* Domain Input */}
      <div style={styles.inputGroup}>
        <label style={styles.label}>SNS Domain</label>
        <div style={styles.inputRow}>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="buildonsns.sol"
            style={styles.input}
            disabled={loading}
          />
        </div>
        <p style={styles.hint}>
          Enter your .sol domain (e.g. buildonsns.sol)
        </p>
      </div>

      {/* Action Button */}
      <button
        onClick={() => {
          if (!wallet.publicKey) {
            setModalVisible(true);
          } else {
            handleUpgrade();
          }
        }}
        disabled={loading}
        style={{
          ...styles.button,
          opacity: loading ? 0.5 : 1,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading
          ? "Upgrading..."
          : !wallet.publicKey
            ? "Connect Wallet to Start"
            : `Upgrade ${inputDomain} → Agent`}
      </button>

      {/* Pipeline info */}
      <div style={styles.pipeline}>
        <div style={styles.pipeStep}>1. Create Core Asset</div>
        <div style={styles.pipeArrow}>→</div>
        <div style={styles.pipeStep}>2. Upload Metadata (Irys)</div>
        <div style={styles.pipeArrow}>→</div>
        <div style={styles.pipeStep}>3. Set SNS Record V2</div>
        <div style={styles.pipeArrow}>→</div>
        <div style={styles.pipeStep}>4. Agent Ready</div>
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div style={styles.logContainer}>
          <h3 style={styles.logTitle}>Transaction Log</h3>
          {logs.map((log, i) => (
            <div
              key={i}
              style={{
                ...styles.logEntry,
                borderLeft: `3px solid ${
                  log.type === "error"
                    ? "#ff4444"
                    : log.type === "success"
                      ? "#00cc88"
                      : "#666"
                }`,
              }}
            >
              <span style={styles.logStep}>[{log.step}]</span>
              <span style={styles.logDetail}>{log.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={styles.resultBox}>
          <h3 style={styles.resultTitle}>Agent Created</h3>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>Core Asset:</span>
            <code style={styles.resultValue}>{result.coreAssetPubkey}</code>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>Metadata URI:</span>
            <code style={styles.resultValue}>{result.metadataUri}</code>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>Core Asset TX:</span>
            <code style={styles.resultValue}>{result.coreAssetTxSig}</code>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>SNS Record TX:</span>
            <code style={styles.resultValue}>{result.snsRecordTxSig}</code>
          </div>
          <p style={styles.resultHint}>
            SNS TXT record set to: agent_core={result.coreAssetPubkey}
            <br />
            This Core Asset is now the AI Agent identity for {inputDomain}.
          </p>
        </div>
      )}

      {/* Agent Console — shown after upgrade */}
      {result && (
        <AgentConsole
          domain={inputDomain}
          coreAssetPubkey={result.coreAssetPubkey}
        />
      )}
    </div>
  );
}

// ---------- Styles ----------

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "40px 20px",
  },
  header: {
    textAlign: "center",
    marginBottom: 32,
  },
  title: {
    fontSize: 36,
    fontWeight: 700,
    background: "linear-gradient(135deg, #9945FF, #14F195)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: 0,
  },
  subtitle: {
    color: "#888",
    fontSize: 14,
    marginTop: 8,
  },
  walletRow: {
    display: "flex",
    justifyContent: "center",
    gap: 8,
    marginBottom: 8,
  },
  walletBtn: {
    background: "#9945FF",
    borderRadius: 8,
    fontSize: 14,
    height: 44,
  },
  disconnectBtn: {
    background: "#333",
    borderRadius: 8,
    fontSize: 14,
    height: 44,
  },
  walletAddr: {
    textAlign: "center" as const,
    fontSize: 13,
    color: "#14F195",
    marginBottom: 20,
    fontFamily: "monospace",
  },
  walletHint: {
    textAlign: "center" as const,
    fontSize: 12,
    color: "#666",
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    display: "block",
    fontSize: 12,
    color: "#888",
    marginBottom: 6,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  inputRow: {
    display: "flex",
    gap: 8,
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    fontSize: 16,
    background: "#1a1a2e",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#e0e0e0",
    outline: "none",
    fontFamily: "monospace",
  },
  hint: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  button: {
    width: "100%",
    padding: "14px 24px",
    fontSize: 16,
    fontWeight: 600,
    background: "linear-gradient(135deg, #9945FF, #14F195)",
    color: "#000",
    border: "none",
    borderRadius: 8,
    marginBottom: 24,
    fontFamily: "inherit",
  },
  pipeline: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
    flexWrap: "wrap" as const,
  },
  pipeStep: {
    fontSize: 11,
    padding: "4px 10px",
    background: "#1a1a2e",
    borderRadius: 4,
    border: "1px solid #333",
    color: "#aaa",
  },
  pipeArrow: {
    color: "#555",
    fontSize: 14,
  },
  logContainer: {
    background: "#111",
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
    border: "1px solid #222",
  },
  logTitle: {
    fontSize: 13,
    color: "#888",
    margin: "0 0 12px 0",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  logEntry: {
    padding: "6px 12px",
    marginBottom: 4,
    fontSize: 13,
    fontFamily: "monospace",
  },
  logStep: {
    color: "#9945FF",
    marginRight: 8,
  },
  logDetail: {
    color: "#ccc",
    wordBreak: "break-all" as const,
  },
  resultBox: {
    background: "#0d1f0d",
    border: "1px solid #14F195",
    borderRadius: 8,
    padding: 20,
  },
  resultTitle: {
    color: "#14F195",
    margin: "0 0 16px 0",
    fontSize: 16,
  },
  resultRow: {
    marginBottom: 8,
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    flexWrap: "wrap" as const,
  },
  resultLabel: {
    fontSize: 12,
    color: "#888",
    minWidth: 100,
  },
  resultValue: {
    fontSize: 12,
    color: "#14F195",
    wordBreak: "break-all" as const,
    background: "#0a150a",
    padding: "2px 6px",
    borderRadius: 4,
  },
  resultHint: {
    fontSize: 12,
    color: "#888",
    marginTop: 16,
    lineHeight: 1.6,
  },
};
