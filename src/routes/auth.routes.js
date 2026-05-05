import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

export const authRouter = Router();

/**
 * POST /api/auth/login
 * body: { email, password }
 */
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: "email dan password wajib" });
    }
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Email atau password salah" });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Email atau password salah" });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ message: "JWT_SECRET belum di-set" });

    const token = jwt.sign(
      {
        sub: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId.toString(),
      },
      secret,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        monthlyFeeAmount: user.monthlyFeeAmount,
        organizationId: user.organizationId,
      },
    });
  } catch (e) {
    next(e);
  }
});
