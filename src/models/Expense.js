import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    occurredAt: { type: Date, required: true },
    category: { type: String, trim: true },
    notes: { type: String, trim: true },
    attachmentUrl: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const Expense = mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
