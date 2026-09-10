import { useState } from 'react';

/** Read-only source view with a copy button — the "paste this" half of an example. */
export function CodePanel({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context) — no fallback needed here.
    }
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <button
        type="button"
        onClick={copy}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'var(--surface)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre
        style={{
          margin: 0,
          height: '100%',
          padding: 16,
          overflow: 'auto',
          background: 'var(--sunken)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          fontSize: 12.5,
          lineHeight: 1.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}
