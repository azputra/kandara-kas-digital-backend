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

  // Midtrans redirect URLs (HTTPS). VT-Web will GET these after payment flow.
  // Deep link back to the mobile app can be wired later; for now this confirms success in-browser.
  const paymentReturnHtml = (title, body) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#e5e7eb;margin:0;padding:32px;}
.card{max-width:520px;margin:0 auto;background:#121a31;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:24px;}
h1{font-size:20px;margin:0 0 8px;}
p{margin:0;color:#94a3b8;line-height:1.5;}
</style></head><body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;

  app.get("/payment/finish", (_req, res) => {
    res
      .status(200)
      .type("html")
      .send(
        paymentReturnHtml(
          "Pembayaran selesai",
          "Silakan kembali ke aplikasi Kandara Kas Digital. Status pembayaran akan ter-update otomatis setelah notifikasi Midtrans diterima server."
        )
      );
  });

  app.get("/payment/unfinish", (_req, res) => {
    res
      .status(200)
      .type("html")
      .send(
        paymentReturnHtml(
          "Pembayaran belum selesai",
          "Kamu menutup halaman pembayaran sebelum selesai. Silakan buka lagi dari aplikasi untuk melanjutkan."
        )
      );
  });

  app.get("/payment/error", (_req, res) => {
    res
      .status(200)
      .type("html")
      .send(
        paymentReturnHtml(
          "Terjadi kesalahan pembayaran",
          "Silakan coba lagi dari aplikasi. Jika masalah berlanjut, hubungi HR."
        )
      );
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
