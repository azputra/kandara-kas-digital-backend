import { Router } from "express";
import mongoose from "mongoose";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { createSnapTransaction } from "../services/midtrans.service.js";

export const paymentsRouter = Router();

const PAID_STATUSES = ["settlement", "capture"];

function generateOrderId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `KAS-${t}-${r}`.toUpperCase();
}

/**
 * POST /api/payments/intents
 * Membuat pembayaran pending + orderId (integrasi Midtrans charge bisa ditambahkan di sini).
 * body: { months: [{ year, month }, ...] } — untuk menghitung amount dari monthlyFee user.
 */
paymentsRouter.post("/intents", requireAuth, async (req, res, next) => {
  try {
    const { months } = req.body || {};
    if (!Array.isArray(months) || months.length === 0) {
      return res.status(400).json({ message: "months wajib berisi minimal satu bulan" });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

    const normalized = [];
    const seen = new Set();
    for (const raw of months) {
      const year = Number(raw?.year);
      const month = Number(raw?.month);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Setiap item months wajib { year, month } yang valid" });
      }
      const key = `${year}-${month}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ year, month });
    }
    if (normalized.length === 0) {
      return res.status(400).json({ message: "months tidak valid" });
    }

    for (const { year, month } of normalized) {
      const alreadyPaid = await Payment.findOne({
        userId: user._id,
        status: { $in: PAID_STATUSES },
        monthsCovered: { $elemMatch: { year, month } },
      }).lean();
      if (alreadyPaid) {
        return res.status(409).json({
          message: `Iuran ${month}/${year} sudah lunas. Tidak perlu bayar lagi.`,
        });
      }
      const pending = await Payment.findOne({
        userId: user._id,
        status: "pending",
        monthsCovered: { $elemMatch: { year, month } },
      }).lean();
      if (pending) {
        return res.status(409).json({
          message: `Masih ada tagihan menunggu pembayaran untuk ${month}/${year}. Lanjutkan pembayaran yang sama atau tunggu hingga selesai/kadaluarsa.`,
          existingOrderId: pending.orderId,
          existingRedirectUrl: pending.snapRedirectUrl || null,
        });
      }
    }

    const fee = user.monthlyFeeAmount;
    const amount = fee * normalized.length;

    const orderId = generateOrderId();
    const doc = await Payment.create({
      organizationId: user.organizationId,
      userId: user._id,
      orderId,
      amount,
      monthsCovered: normalized,
      status: "pending",
    });

    const snap = await createSnapTransaction({
      transaction_details: {
        order_id: doc.orderId,
        gross_amount: doc.amount,
      },
      customer_details: {
        email: user.email,
        first_name: user.displayName,
      },
      // enabled_payments: ["bank_transfer"], // bisa dipersempit nanti
    });

    doc.snapToken = snap?.token;
    doc.snapRedirectUrl = snap?.redirect_url;
    await doc.save();

    return res.status(201).json({
      payment: doc,
      midtrans: {
        clientKey: process.env.MIDTRANS_CLIENT_KEY || null,
        orderId: doc.orderId,
        grossAmount: doc.amount,
        snapToken: doc.snapToken || null,
        redirectUrl: doc.snapRedirectUrl || null,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/payments/me — riwayat pembayaran user login
 */
paymentsRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const list = await Payment.find({ userId: new mongoose.Types.ObjectId(req.user.id) })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ payments: list });
  } catch (e) {
    next(e);
  }
});
