export * from "./sandbox/index";

export const sandboxService = {
  executeCommand: async (cmd: string, cwd?: string) => ({ exitCode: 0, stdout: "", stderr: "" }),
  writeFile: async (relPath: string, content: string) => {},
  readFile: async (relPath: string) => "",
};
