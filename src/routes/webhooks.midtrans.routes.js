import { Router } from "express";
import { Payment } from "../models/Payment.js";
import { verifyNotificationSignature } from "../services/midtrans.service.js";

export const midtransWebhookRouter = Router();

/**
 * POST /api/webhooks/midtrans
 * Pasang URL ini di Midtrans Dashboard > Payment Notification URL (Sandbox).
 */
midtransWebhookRouter.post("/midtrans", async (req, res, next) => {
  try {
    const body = req.body;
    if (!verifyNotificationSignature(body)) {
      return res.status(403).json({ message: "Signature tidak valid" });
    }

    const orderId = body.order_id;
    const transactionStatus = body.transaction_status;
    const fraudStatus = body.fraud_status;

    const payment = await Payment.findOne({ orderId });
    if (!payment) {
      return res.status(404).json({ message: "Order tidak ditemukan" });
    }

    payment.rawNotification = body;
    if (body.transaction_id) payment.midtransTransactionId = String(body.transaction_id);

    if (transactionStatus === "capture" && fraudStatus === "accept") {
      payment.status = "capture";
    } else if (transactionStatus === "settlement") {
      payment.status = "settlement";
    } else if (transactionStatus === "pending") {
      payment.status = "pending";
    } else if (transactionStatus === "deny") {
      payment.status = "deny";
    } else if (transactionStatus === "cancel") {
      payment.status = "cancel";
    } else if (transactionStatus === "expire") {
      payment.status = "expire";
    } else if (transactionStatus === "failure") {
      payment.status = "failure";
    }

    await payment.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`org:${payment.organizationId}`).emit("payment:updated", {
        orderId: payment.orderId,
        status: payment.status,
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
