import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    /** Saldo awal dari tahun sebelumnya (carry forward), IDR */
    openingBalance: { type: Number, default: 0 },
    currency: { type: String, default: "IDR" },
  },
  { timestamps: true }
);

export const Organization =
  mongoose.models.Organization || mongoose.model("Organization", organizationSchema);
