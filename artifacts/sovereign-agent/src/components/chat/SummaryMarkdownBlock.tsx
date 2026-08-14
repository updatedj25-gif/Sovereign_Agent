import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy } from "lucide-react";

export interface SummaryMarkdownBlockProps {
  summary?: string;
  content?: string;
}

export function SummaryMarkdownBlock({ summary, content }: SummaryMarkdownBlockProps) {
  const textContent = summary || content || "";
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  if (!textContent) return null;

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed break-words space-y-2 font-sans text-xs">
      <ReactMarkdown
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");
            const isInline = !match && !codeString.includes("\n");

            if (isInline) {
              return (
                <code
                  className="bg-slate-900 text-amber-300 px-1.5 py-0.5 rounded text-[12px] font-mono border border-slate-800"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            const codeId = `code-${Math.random().toString(36).substring(2, 7)}`;

            return (
              <div className="relative group my-3 rounded-lg overflow-hidden border border-slate-800 bg-slate-950 font-mono">
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-[11px] text-slate-400">
                  <span>{match ? match[1] : "code"}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(codeString, codeId)}
                    className="flex items-center gap-1 hover:text-slate-200 transition-colors"
                  >
                    {copiedCode === codeId ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 overflow-x-auto text-xs font-mono text-slate-200 bg-slate-950 m-0">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 space-y-1 mb-2">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-1 mb-2">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-slate-300">{children}</li>;
          },
          h1({ children }) {
            return <h1 className="text-base font-bold text-slate-100 mt-3 mb-1">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-sm font-bold text-slate-100 mt-2 mb-1">{children}</h2>;
          },
        }}
      >
        {textContent}
      </ReactMarkdown>
    </div>
  );
}