import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { globalToolRegistry, ToolExecutionResult, ToolExecutionContext } from "../agent/registry";
import { executeCommand } from "./executor";

export interface NpmsPackageInfo {
  name: string;
  version: string;
  description: string;
  keywords?: string[];
  peerDependencies?: Record<string, string>;
  dependenciesCount?: number;
  license?: string;
  homepage?: string;
}

/**
 * Query official NPM registry for package information, latest versions, and peer dependencies
 */
export async function searchNpmPackage(packageName: string): Promise<NpmsPackageInfo> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Package '${packageName}' was not found in NPM registry.`);
    }
    throw new Error(`NPM registry returned HTTP ${response.status} for '${packageName}'`);
  }

  const data = (await response.json()) as any;
  const latestVersion = data["dist-tags"]?.latest;
  const latestManifest = data.versions?.[latestVersion] || {};

  return {
    name: data.name,
    version: latestVersion,
    description: data.description || latestManifest.description || "",
    keywords: latestManifest.keywords || [],
    peerDependencies: latestManifest.peerDependencies || undefined,
    dependenciesCount: Object.keys(latestManifest.dependencies || {}).length,
    license: data.license || latestManifest.license || "N/A",
    homepage: data.homepage || undefined,
  };
}

/**
 * Read and parse local package.json
 */
export async function inspectPackageJson(
  workspaceRoot: string = process.cwd()
): Promise<{ dependencies: Record<string, string>; devDependencies: Record<string, string> }> {
  const pkgPath = path.resolve(workspaceRoot, "package.json");
  const content = await fs.readFile(pkgPath, "utf-8");
  const json = JSON.parse(content);

  return {
    dependencies: json.dependencies || {},
    devDependencies: json.devDependencies || {},
  };
}

// ==========================================
// Register Package Management Tools
// ==========================================

globalToolRegistry.registerTool({
  name: "search_npm_package",
  description:
    "Query NPM registry to verify package existence, latest version, description, and peer dependencies before installation.",
  parameters: z.object({
    packageName: z.string().describe("Exact NPM package name (e.g. 'lucide-react', '@tanstack/react-query')."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "npm_search_started",
        packageName: args.packageName,
      });

      const pkgInfo = await searchNpmPackage(args.packageName);

      const peerDepSummary = pkgInfo.peerDependencies
        ? Object.entries(pkgInfo.peerDependencies)
            .map(([k, v]) => `  - ${k}: ${v}`)
            .join("\n")
        : "  None";

      const outputSummary = [
        `PACKAGE: ${pkgInfo.name} @ v${pkgInfo.version}`,
        `Description: ${pkgInfo.description}`,
        `License: ${pkgInfo.license}`,
        `Homepage: ${pkgInfo.homepage || "N/A"}`,
        `Peer Dependencies:\n${peerDepSummary}`,
      ].join("\n");

      return {
        success: true,
        output: outputSummary,
        data: pkgInfo,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `NPM Package Search Error: ${err.message}`,
        error: "NPM_SEARCH_FAILED",
      };
    }
  },
});

globalToolRegistry.registerTool({
  name: "manage_dependencies",
  description:
    "Install (`pnpm add`) or remove (`pnpm remove`) project dependencies across the monorepo.",
  requiresApproval: true,
  parameters: z.object({
    action: z.enum(["install", "remove", "inspect"]).describe("Action to perform on dependencies."),
    packages: z
      .array(z.string())
      .optional()
      .describe("Package name(s) with optional version tags (e.g. ['clsx@^2.0.0', 'zod'])."),
    isDevDependency: z
      .boolean()
      .optional()
      .describe("Save as devDependency (-D flag) during install."),
    filterPackage: z
      .string()
      .optional()
      .describe("Filter target workspace package (e.g. '--filter @workspace/api-server')."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    if (args.action === "inspect") {
      try {
        const pkgData = await inspectPackageJson();
        return {
          success: true,
          output: `Current Local Dependencies:\n${JSON.stringify(pkgData, null, 2)}`,
          data: pkgData,
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to inspect package.json: ${err.message}`,
          error: "INSPECT_PKG_FAILED",
        };
      }
    }

    if (!args.packages || args.packages.length === 0) {
      return {
        success: false,
        output: "Package name array required for 'install' or 'remove' action.",
        error: "MISSING_PACKAGES",
      };
    }

    const devFlag = args.isDevDependency ? "-D" : "";
    const filterFlag = args.filterPackage ? `--filter ${args.filterPackage}` : "";
    const packagesStr = args.packages.join(" ");

    const command =
      args.action === "install"
        ? `pnpm ${filterFlag} add ${devFlag} ${packagesStr}`.replace(/\s+/g, " ")
        : `pnpm ${filterFlag} remove ${packagesStr}`.replace(/\s+/g, " ");

    context.emitEvent?.({
      type: "manage_dependencies_started",
      command,
    });

    const res = await executeCommand({
      command,
      timeoutMs: 60000,
    });

    return {
      success: res.success,
      output: `Executed: ${command}\nExit Code: ${res.exitCode}\n\n${res.stdout || res.stderr}`,
      data: {
        command,
        exitCode: res.exitCode,
      },
    };
  },
});