import { Router } from "express";
import mongoose from "mongoose";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { createSnapTransaction } from "../services/midtrans.service.js";

export const paymentsRouter = Router();

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

    const fee = user.monthlyFeeAmount;
    const amount = fee * months.length;

    const orderId = generateOrderId();
    const doc = await Payment.create({
      organizationId: user.organizationId,
      userId: user._id,
      orderId,
      amount,
      monthsCovered: months.map((m) => ({
        year: Number(m.year),
        month: Number(m.month),
      })),
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
