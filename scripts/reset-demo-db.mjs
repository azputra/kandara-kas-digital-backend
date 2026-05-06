/**
 * Hapus data aplikasi di MongoDB (users, payments, expenses, organizations).
 * WAJIB set ALLOW_RESET_DEMO=yes supaya tidak ke-trigger tanpa sengaja.
 *
 * Usage:
 *   ALLOW_RESET_DEMO=yes node scripts/reset-demo-db.mjs
 * lalu:
 *   npm run seed
 */
import "dotenv/config";
import mongoose from "mongoose";

if (process.env.ALLOW_RESET_DEMO !== "yes") {
  console.error("Refusing: set environment ALLOW_RESET_DEMO=yes");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI belum di-set");
  process.exit(1);
}

const collections = ["users", "payments", "expenses", "organizations"];

await mongoose.connect(uri);
for (const name of collections) {
  try {
    await mongoose.connection.collection(name).drop();
    console.log("dropped:", name);
  } catch (e) {
    console.log("skip:", name, String(e?.message || e));
  }
}
await mongoose.disconnect();
console.log("Selesai. Jalankan: npm run seed");
