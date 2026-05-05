import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

export const uploadsRouter = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

function extFromMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return "";
}

/**
 * POST /api/uploads/receipt
 * multipart/form-data: file=<image>
 * returns { url }
 */
uploadsRouter.post(
  "/receipt",
  requireAuth,
  requireRole("hr", "admin"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "file wajib" });
      if (!String(file.mimetype || "").startsWith("image/")) {
        return res.status(400).json({ message: "file harus gambar" });
      }

      const ext = extFromMime(file.mimetype) || ".bin";
      const id = crypto.randomBytes(8).toString("hex");
      const name = `receipt-${Date.now()}-${id}${ext}`;

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const relDir = path.join("..", "..", "uploads", "org", String(req.user.organizationId));
      const absDir = path.join(__dirname, relDir);
      await fs.mkdir(absDir, { recursive: true });

      const absPath = path.join(absDir, name);
      await fs.writeFile(absPath, file.buffer);

      const url = `/uploads/org/${req.user.organizationId}/${name}`;
      res.status(201).json({ url });
    } catch (e) {
      next(e);
    }
  }
);

