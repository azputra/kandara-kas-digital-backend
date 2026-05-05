import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { authRouter } from "./routes/auth.routes.js";
import { paymentsRouter } from "./routes/payments.routes.js";
import { midtransWebhookRouter } from "./routes/webhooks.midtrans.routes.js";
import { hrRouter } from "./routes/hr.routes.js";
import { uploadsRouter } from "./routes/uploads.routes.js";

export function createApp() {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "4mb" }));

  // Serve uploaded files (demo only).
  app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "kandara-kas-digital-api" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/hr", hrRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/webhooks", midtransWebhookRouter);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: err.message || "Kesalahan server" });
  });

  return app;
}
