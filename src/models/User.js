import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["member", "hr", "admin"],
      default: "member",
    },
    /** Nominal iuran default per bulan (IDR), mis. 30000 / 50000 / 100000 */
    monthlyFeeAmount: { type: Number, required: true, min: 0 },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
