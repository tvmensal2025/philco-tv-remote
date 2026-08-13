"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export default function CopyConfigButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return <button type="button" className="copyButton" title={`Copiar ${value}`} aria-label={`Copiar nome ${value}`} onClick={copy}>{copied ? <Check/> : <Copy/>}</button>;
}
