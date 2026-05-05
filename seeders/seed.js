import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { Organization } from "../src/models/Organization.js";
import { User } from "../src/models/User.js";

async function run() {
  await connectDb();

  const org = await Organization.findOneAndUpdate(
    { slug: "kandara" },
    {
      $setOnInsert: {
        name: "Kandara Kas Digital",
        slug: "kandara",
        openingBalance: 8_146_400,
        currency: "IDR",
      },
    },
    { upsert: true, new: true }
  );

  const passwordPlain = process.env.SEED_DEFAULT_PASSWORD || "KandaraDev123!";
  const passwordHash = await bcrypt.hash(passwordPlain, 10);

  const users = [
    {
      email: "hr@kandara.local",
      displayName: "Admin HR",
      role: "hr",
      monthlyFeeAmount: 100_000,
    },
    {
      email: "anggota@kandara.local",
      displayName: "Anggota Contoh",
      role: "member",
      monthlyFeeAmount: 50_000,
    },
  ];

  for (const u of users) {
    await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          passwordHash,
          displayName: u.displayName,
          role: u.role,
          monthlyFeeAmount: u.monthlyFeeAmount,
          organizationId: org._id,
          isActive: true,
        },
      },
      { upsert: true }
    );
  }

  console.log("Seed selesai.");
  console.log(`Organisasi: ${org.name} (${org.slug})`);
  console.log("Akun contoh:");
  for (const u of users) {
    console.log(`  ${u.email} / ${passwordPlain}  [${u.role}]`);
  }

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
