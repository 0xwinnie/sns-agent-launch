"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { parseCommand, executeCommand, type ActionResult } from "@/lib/agentActions";

interface Message {
  role: "user" | "agent";
  content: string;
  txSig?: string;
  isError?: boolean;
  ts: number;
}

interface AgentConsoleProps {
  domain: string;
  coreAssetPubkey: string;
}

export default function AgentConsole({ domain, coreAssetPubkey }: AgentConsoleProps) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "agent",
      content: `Agent for ${domain} is online.\nCore Asset: ${coreAssetPubkey.slice(0, 8)}...${coreAssetPubkey.slice(-4)}\n\nType "help" for available commands.`,
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [executing, setExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const addMessage = useCallback(
    (role: Message["role"], content: string, txSig?: string, isError?: boolean) => {
      setMessages((prev) => [...prev, { role, content, txSig, isError, ts: Date.now() }]);
    },
    []
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || executing) return;

    setInput("");
    addMessage("user", trimmed);

    setExecuting(true);
    addMessage("agent", "Thinking...");

    try {
      const cmd = parseCommand(trimmed);

      // Simulate agent "thinking"
      await new Promise((r) => setTimeout(r, 500));

      // Remove "Thinking..." message
      setMessages((prev) => prev.slice(0, -1));

      // Show what the agent understood
      if (cmd.action !== "help" && cmd.action !== "unknown") {
        addMessage("agent", `Executing: ${cmd.action}${cmd.amount ? ` ${cmd.amount}` : ""} ${cmd.token || ""}${cmd.toToken ? ` → ${cmd.toToken}` : ""}${cmd.recipient ? ` to ${cmd.recipient.slice(0, 6)}...` : ""}...`);
      }

      const result: ActionResult = await executeCommand(cmd, wallet, connection);

      if (result.success) {
        addMessage("agent", result.message, result.txSig);
      } else {
        addMessage("agent", result.message, undefined, true);
      }
    } catch (e: any) {
      setMessages((prev) => prev.slice(0, -1));
      addMessage("agent", `Error: ${e.message}`, undefined, true);
    } finally {
      setExecuting(false);
    }
  }, [input, executing, wallet, connection, addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const explorerBase = connection.rpcEndpoint.includes("devnet")
    ? "https://explorer.solana.com/tx/{sig}?cluster=devnet"
    : "https://explorer.solana.com/tx/{sig}";

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerDot} />
        <span style={styles.headerTitle}>Agent Console — {domain}</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={styles.messages}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.msgRow,
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                ...styles.bubble,
                ...(msg.role === "user" ? styles.userBubble : styles.agentBubble),
                ...(msg.isError ? styles.errorBubble : {}),
              }}
            >
              <pre style={styles.msgText}>{msg.content}</pre>
              {msg.txSig && (
                <a
                  href={explorerBase.replace("{sig}", msg.txSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.txLink}
                >
                  View on Explorer →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={styles.inputRow}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={executing ? "Executing..." : "Type a command... (e.g. help, balance, swap 0.01 SOL to USDC)"}
          disabled={executing}
          style={styles.input}
        />
        <button
          onClick={handleSend}
          disabled={executing || !input.trim()}
          style={{
            ...styles.sendBtn,
            opacity: executing || !input.trim() ? 0.4 : 1,
          }}
        >
          Send
        </button>
      </div>

      {/* Quick actions */}
      <div style={styles.quickActions}>
        {["help", "balance", "swap 0.01 SOL to USDC", "transfer 0.001 SOL to "].map(
          (cmd) => (
            <button
              key={cmd}
              onClick={() => setInput(cmd)}
              style={styles.quickBtn}
              disabled={executing}
            >
              {cmd}
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ---------- Styles ----------

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: 32,
    border: "1px solid #333",
    borderRadius: 12,
    overflow: "hidden",
    background: "#0d0d0d",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    background: "#1a1a2e",
    borderBottom: "1px solid #333",
  },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#14F195",
  },
  headerTitle: {
    fontSize: 13,
    color: "#aaa",
    fontFamily: "monospace",
  },
  messages: {
    height: 360,
    overflowY: "auto" as const,
    padding: 16,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  msgRow: {
    display: "flex",
  },
  bubble: {
    maxWidth: "85%",
    padding: "8px 14px",
    borderRadius: 10,
    fontSize: 13,
    fontFamily: "monospace",
    lineHeight: 1.5,
  },
  userBubble: {
    background: "#9945FF",
    color: "#fff",
    borderBottomRightRadius: 2,
  },
  agentBubble: {
    background: "#1a1a2e",
    color: "#e0e0e0",
    border: "1px solid #333",
    borderBottomLeftRadius: 2,
  },
  errorBubble: {
    borderColor: "#ff4444",
    color: "#ff8888",
  },
  msgText: {
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  txLink: {
    display: "inline-block",
    marginTop: 6,
    fontSize: 11,
    color: "#14F195",
    textDecoration: "none",
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: "12px 16px",
    borderTop: "1px solid #222",
    background: "#111",
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    fontSize: 14,
    background: "#1a1a2e",
    border: "1px solid #333",
    borderRadius: 8,
    color: "#e0e0e0",
    outline: "none",
    fontFamily: "monospace",
  },
  sendBtn: {
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    background: "#9945FF",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  quickActions: {
    display: "flex",
    gap: 6,
    padding: "0 16px 12px",
    flexWrap: "wrap" as const,
  },
  quickBtn: {
    padding: "4px 10px",
    fontSize: 11,
    background: "#1a1a2e",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#888",
    cursor: "pointer",
    fontFamily: "monospace",
  },
};
