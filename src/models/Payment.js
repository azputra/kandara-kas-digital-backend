import mongoose from "mongoose";

const monthCoverageSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Harus unik per charge Midtrans */
    orderId: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "IDR" },
    /** Bulan yang dibayar (bisa lebih dari satu, mis. April + Mei) */
    monthsCovered: { type: [monthCoverageSchema], default: [] },
    status: {
      type: String,
      enum: ["pending", "settlement", "capture", "deny", "cancel", "expire", "failure"],
      default: "pending",
    },
    snapToken: { type: String },
    snapRedirectUrl: { type: String },
    midtransTransactionId: { type: String },
    rawNotification: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const Payment = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
