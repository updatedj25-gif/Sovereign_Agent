import { useState } from "react";
import { KeyRound, Eye, EyeOff, ShieldCheck, Check, Sparkles, AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EnvKeyDescriptor {
  name: string;
  label: string;
  source: string;
  sourceCategory?: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
}

export interface DeploymentTarget {
  name: string;
  suggestedAction: string;
}

export interface EnvRequestData {
  stage: "initial_setup" | "mid_task" | "deployment_finalization";
  sourceCategory?: string;
  keys: EnvKeyDescriptor[];
  deploymentTarget?: DeploymentTarget;
  reason?: string;
}

interface EnvInputBoxProps {
  data: EnvRequestData;
  onSubmitEnvs?: (values: Record<string, string>) => void;
  workspaceGroupId?: string;
}

interface CustomKey {
  id: string;
  name: string;
  value: string;
  source: string;
}

export function EnvInputBox({ data, onSubmitEnvs, workspaceGroupId = "default" }: EnvInputBoxProps) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [customKeys, setCustomKeys] = useState<CustomKey[]>([]);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Group preset keys by source or sourceCategory
  const groups = (data.keys || []).reduce<Record<string, EnvKeyDescriptor[]>>((acc, key) => {
    const category = key.sourceCategory || key.source || "Environment Keys";
    if (!acc[category]) acc[category] = [];
    acc[category].push(key);
    return acc;
  }, {});

  const toggleShowSecret = (keyName: string) => {
    setShowSecrets((prev) => ({ ...prev, [keyName]: !prev[keyName] }));
  };

  const handleInputChange = (keyName: string, val: string) => {
    setFormValues((prev) => ({ ...prev, [keyName]: val }));
    setIsSaved(false);
  };

  const handleAddCustomKey = () => {
    const newId = `custom_${Date.now()}`;
    setCustomKeys((prev) => [
      ...prev,
      { id: newId, name: "", value: "", source: "Custom Secret" },
    ]);
  };

  const handleRemoveCustomKey = (id: string) => {
    setCustomKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleCustomKeyChange = (id: string, field: "name" | "value", val: string) => {
    setCustomKeys((prev) =>
      prev.map((k) => (k.id === id ? { ...k, [field]: val } : k))
    );
    setIsSaved(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    // Combine formValues with customKeys
    const payloadEnvs: Record<string, string> = { ...formValues };
    for (const ck of customKeys) {
      if (ck.name.trim()) {
        payloadEnvs[ck.name.trim().toUpperCase()] = ck.value;
      }
    }

    if (Object.keys(payloadEnvs).length === 0) {
      setErrorMsg("Please provide at least one environment key and value.");
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/agent/env-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceGroupId,
          envs: payloadEnvs,
        }),
      });

      if (res.ok) {
        setIsSaved(true);
        if (onSubmitEnvs) {
          onSubmitEnvs(payloadEnvs);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setErrorMsg(errData.error || "Failed to persist environment variables.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to communicate with API server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSourceBadgeStyle = (sourceName: string) => {
    const s = sourceName.toLowerCase();
    if (s.includes("supabase")) return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    if (s.includes("cloudflare")) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    if (s.includes("vercel")) return "bg-sky-500/20 text-sky-300 border-sky-500/40";
    if (s.includes("gemini") || s.includes("google")) return "bg-blue-500/20 text-blue-300 border-blue-500/40";
    if (s.includes("stripe")) return "bg-purple-500/20 text-purple-300 border-purple-500/40";
    if (s.includes("firebase")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/40";
    if (s.includes("github")) return "bg-slate-500/20 text-slate-200 border-slate-500/40";
    return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  };

  const stageBadgeLabel =
    data.stage === "initial_setup"
      ? "Initial Setup Credentials"
      : data.stage === "mid_task"
      ? "In-Flight Secret Request"
      : "Deployment Finalization Secrets";

  const hasPresetKeys = Object.keys(groups).length > 0;

  return (
    <div className="bg-slate-900/95 border border-amber-500/35 rounded-xl p-4 shadow-[0_0_24px_rgba(245,158,11,0.08)] space-y-4 font-mono text-xs my-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-white text-xs tracking-tight flex items-center gap-2">
              Environment Secrets Box
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border uppercase bg-amber-500/10 text-amber-400 border-amber-500/20">
                {stageBadgeLabel}
              </span>
            </h4>
            <p className="text-[11px] text-slate-400 font-sans mt-0.5">
              {data.reason || "Provide environment keys or add custom secrets for runtime execution and deployment."}
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Preset Keys */}
        {hasPresetKeys ? (
          Object.entries(groups).map(([groupTitle, keys]) => (
            <div key={groupTitle} className="space-y-2.5 bg-slate-950/70 border border-slate-800/80 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border", getSourceBadgeStyle(groupTitle))}>
                  {groupTitle}
                </span>
                <span className="text-[10px] text-slate-500 font-sans">
                  {keys.length} key{keys.length > 1 ? "s" : ""}
                </span>
              </div>

              <div className="space-y-3 pt-1">
                {keys.map((k) => (
                  <div key={k.name} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor={k.name} className="font-semibold text-slate-200 flex items-center gap-1.5">
                        {k.label}
                        <span className="text-slate-500 font-mono text-[10px]">({k.name})</span>
                        {k.required && <span className="text-amber-400">*</span>}
                      </label>
                      <span className="text-[10px] text-slate-500">{k.source}</span>
                    </div>

                    {k.description && (
                      <p className="text-[10px] text-slate-400 font-sans leading-snug">{k.description}</p>
                    )}

                    <div className="relative flex items-center">
                      <input
                        id={k.name}
                        type={showSecrets[k.name] ? "text" : "password"}
                        value={formValues[k.name] || ""}
                        onChange={(e) => handleInputChange(k.name, e.target.value)}
                        placeholder={k.placeholder || `Enter ${k.name}`}
                        className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/60 rounded-md px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/40 pr-9 font-mono transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowSecret(k.name)}
                        className="absolute right-2.5 text-slate-500 hover:text-slate-300 transition-colors"
                        title={showSecrets[k.name] ? "Hide Secret" : "Show Secret"}
                      >
                        {showSecrets[k.name] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          /* Empty Env Box state */
          <div className="bg-slate-950/70 border border-dashed border-slate-800 rounded-lg p-3.5 text-center space-y-2">
            <p className="text-slate-400 text-xs font-sans">
              No pre-defined keys required. Add custom key-value environment variables below.
            </p>
          </div>
        )}

        {/* Custom Environment Variable Fields */}
        {customKeys.length > 0 && (
          <div className="space-y-2 bg-slate-950/70 border border-slate-800/80 rounded-lg p-3">
            <span className="text-[10px] font-mono font-bold uppercase text-amber-400 tracking-wider">
              Custom Key-Value Secrets ({customKeys.length})
            </span>
            <div className="space-y-2 pt-1">
              {customKeys.map((ck) => (
                <div key={ck.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={ck.name}
                    onChange={(e) => handleCustomKeyChange(ck.id, "name", e.target.value)}
                    placeholder="KEY_NAME (e.g. API_SECRET)"
                    className="w-1/2 bg-slate-900 border border-slate-800 focus:border-amber-500/60 rounded-md px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none font-mono"
                  />
                  <input
                    type="password"
                    value={ck.value}
                    onChange={(e) => handleCustomKeyChange(ck.id, "value", e.target.value)}
                    placeholder="Secret value"
                    className="w-1/2 bg-slate-900 border border-slate-800 focus:border-amber-500/60 rounded-md px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveCustomKey(ck.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                    title="Remove custom key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Button to Add Custom Key */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleAddCustomKey}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 font-mono text-[11px] rounded-md transition-colors border border-amber-500/20 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add Custom Variable
          </button>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs font-sans">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {isSaved && (
          <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs font-sans">
            <Check className="w-4 h-4 shrink-0 text-emerald-400" />
            <span className="font-semibold">Environment keys saved & synced to workspace .env successfully!</span>
          </div>
        )}

        {/* Submit Action */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>Encrypted & stored in local workspace sandbox</span>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold font-mono text-xs rounded-lg transition-colors shadow-md cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
              </>
            ) : isSaved ? (
              <>
                <Check className="w-3.5 h-3.5" /> Update Envs
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5" /> Save Credentials
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
