import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import app from "./artifacts/api-server/src/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

async function startServer() {
  if (process.env.NODE_ENV === "production") {
    let distPath = path.resolve(__dirname, "./artifacts/sovereign-agent/dist");
    if (!fs.existsSync(distPath)) {
      distPath = path.resolve(__dirname, "./dist");
    }
    app.use(express.static(distPath));

    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          port: 24679, // Custom HMR port to prevent collisions
        },
      },
      root: path.resolve(__dirname, "."),
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`⚡ Sovereign Agent Cockpit & Full-Stack Server active on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});