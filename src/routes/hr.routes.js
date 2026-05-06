import { Router } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import crypto from "crypto";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { Organization } from "../models/Organization.js";
import { Payment } from "../models/Payment.js";
import { Expense } from "../models/Expense.js";
import { User } from "../models/User.js";

export const hrRouter = Router();

const PAID_STATUSES = ["settlement", "capture"];

function parseIntOr(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { start, end };
}

function requireHrAuth(req, res) {
  // Prefer Authorization header; fallback to token query param (demo use-case for browser download).
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const token = bearer;
  if (!token) {
    res.status(401).json({ message: "Token diperlukan" });
    return null;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ message: "JWT_SECRET belum di-set" });
    return null;
  }
  try {
    const decoded = jwt.verify(token, secret);
    const role = decoded?.role;
    if (role !== "hr" && role !== "admin") {
      res.status(403).json({ message: "Akses ditolak" });
      return null;
    }
    return {
      userId: decoded.sub,
      organizationId: decoded.organizationId,
      role,
    };
  } catch {
    res.status(401).json({ message: "Token tidak valid" });
    return null;
  }
}

function rupiah(n) {
  const s = Math.round(Number(n) || 0).toString();
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return `Rp ${parts.join(".")}`;
}

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replaceAll("-", "+").replaceAll("_", "/") + pad;
  return Buffer.from(b64, "base64");
}

function signDownloadToken(payload) {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET belum di-set");
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifyDownloadToken(token) {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET belum di-set");
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = base64UrlEncode(crypto.createHmac("sha256", secret).update(body).digest());
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(base64UrlDecode(body).toString("utf8"));
  if (!payload?.exp || Date.now() > payload.exp) return null;
  return payload;
}

async function computeMonthlyLedger({ orgId, year, month }) {
  const org = await Organization.findById(orgId).lean();
  if (!org) throw new Error("Organisasi tidak ditemukan");

  const users = await User.find({ organizationId: orgId, isActive: true })
    .sort({ displayName: 1 })
    .lean();

  const paidPayments = await Payment.find({
    organizationId: orgId,
    status: { $in: PAID_STATUSES },
    monthsCovered: { $elemMatch: { year, month } },
  }).lean();

  const perUserPaid = new Map(); // userId -> amount allocated for this month
  for (const p of paidPayments) {
    const monthsCovered = Array.isArray(p.monthsCovered) ? p.monthsCovered : [];
    const share = monthsCovered.length > 0 ? p.amount / monthsCovered.length : p.amount;
    const uid = String(p.userId);
    perUserPaid.set(uid, (perUserPaid.get(uid) || 0) + share);
  }

  const { start, end } = monthRange(year, month);
  const expenses = await Expense.find({ organizationId: orgId, occurredAt: { $gte: start, $lt: end } })
    .sort({ occurredAt: -1 })
    .lean();

  const expenseTotal = expenses.reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const incomeTotal = Array.from(perUserPaid.values()).reduce((t, v) => t + v, 0);

  // Overall balance up to now (same as dashboard)
  const totalIncomeAgg = await Payment.aggregate([
    { $match: { organizationId: orgId, status: { $in: PAID_STATUSES } } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const totalIncome = totalIncomeAgg[0]?.total ?? 0;
  const totalExpenseAgg = await Expense.aggregate([
    { $match: { organizationId: orgId } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const totalExpense = totalExpenseAgg[0]?.total ?? 0;
  const balanceNow = (org.openingBalance || 0) + totalIncome - totalExpense;

  const rows = users.map((u) => {
    const paid = perUserPaid.get(String(u._id)) || 0;
    const expected = Number(u.monthlyFeeAmount) || 0;
    const status = paid >= expected ? "Lunas" : paid > 0 ? "Sebagian" : "Belum";
    return {
      userId: u._id,
      role: u.role,
      name: u.displayName,
      email: u.email,
      expected,
      paid,
      status,
    };
  });

  return {
    org,
    period: { year, month },
    incomeTotal,
    expenseTotal,
    balanceNow,
    rows,
    expenses,
  };
}

async function computeYearlyMatrix({ orgId, year }) {
  const org = await Organization.findById(orgId).lean();
  if (!org) throw new Error("Organisasi tidak ditemukan");

  const users = await User.find({ organizationId: orgId, isActive: true })
    .sort({ displayName: 1 })
    .lean();

  const paidPayments = await Payment.find({
    organizationId: orgId,
    status: { $in: PAID_STATUSES },
    monthsCovered: { $elemMatch: { year } },
  }).lean();

  const paidByUserMonth = new Map(); // `${userId}:${month}` -> amount
  for (const p of paidPayments) {
    const monthsCovered = Array.isArray(p.monthsCovered) ? p.monthsCovered : [];
    const inYear = monthsCovered.filter((m) => m?.year === year && Number.isFinite(m?.month));
    if (inYear.length === 0) continue;
    const share = p.amount / monthsCovered.length;
    for (const m of inYear) {
      const key = `${String(p.userId)}:${m.month}`;
      paidByUserMonth.set(key, (paidByUserMonth.get(key) || 0) + share);
    }
  }

  const rows = users.map((u) => {
    const expected = Number(u.monthlyFeeAmount) || 0;
    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const paid = paidByUserMonth.get(`${String(u._id)}:${month}`) || 0;
      return { month, paid, ok: paid >= expected && expected > 0 };
    });
    const totalPaid = months.reduce((t, m) => t + m.paid, 0);
    const paidCount = months.reduce((t, m) => t + (m.ok ? 1 : 0), 0);
    return {
      name: u.displayName,
      email: u.email,
      expected,
      months,
      totalPaid,
      paidCount,
    };
  });

  return { org, year, rows };
}

/**
 * GET /api/hr/dashboard?year=2026&month=5
 * Ringkasan kas untuk HR/Admin.
 */
hrRouter.get("/dashboard", requireAuth, requireRole("hr", "admin"), async (req, res, next) => {
  try {
    const orgId = new mongoose.Types.ObjectId(req.user.organizationId);
    const now = new Date();
    const year = parseIntOr(req.query.year, now.getFullYear());
    const month = parseIntOr(req.query.month, now.getMonth() + 1);

    const org = await Organization.findById(orgId).lean();
    if (!org) return res.status(404).json({ message: "Organisasi tidak ditemukan" });

    const { start, end } = monthRange(year, month);

    // Income month (paid only) — sum amount of payments that cover this month.
    const incomeAgg = await Payment.aggregate([
      { $match: { organizationId: orgId, status: { $in: PAID_STATUSES } } },
      { $unwind: "$monthsCovered" },
      { $match: { "monthsCovered.year": year, "monthsCovered.month": month } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const incomeThisMonth = incomeAgg[0]?.total ?? 0;

    // Expense month
    const expenseAgg = await Expense.aggregate([
      { $match: { organizationId: orgId, occurredAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const expenseThisMonth = expenseAgg[0]?.total ?? 0;

    // Balance (opening + all paid income - all expense)
    const totalIncomeAgg = await Payment.aggregate([
      { $match: { organizationId: orgId, status: { $in: PAID_STATUSES } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalIncome = totalIncomeAgg[0]?.total ?? 0;
    const totalExpenseAgg = await Expense.aggregate([
      { $match: { organizationId: orgId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalExpense = totalExpenseAgg[0]?.total ?? 0;
    const balance = (org.openingBalance || 0) + totalIncome - totalExpense;

    // Unpaid count for this month
    const activeUsers = await User.find({ organizationId: orgId, isActive: true }, { _id: 1 }).lean();
    const activeUserIds = activeUsers.map((u) => u._id.toString());

    const paidUsersAgg = await Payment.aggregate([
      { $match: { organizationId: orgId, status: { $in: PAID_STATUSES } } },
      { $unwind: "$monthsCovered" },
      { $match: { "monthsCovered.year": year, "monthsCovered.month": month } },
      { $group: { _id: "$userId" } },
    ]);
    const paidSet = new Set(paidUsersAgg.map((x) => String(x._id)));
    const unpaidCount = activeUserIds.filter((id) => !paidSet.has(id)).length;

    // Chart: income per month for the given year
    const incomeByMonthAgg = await Payment.aggregate([
      { $match: { organizationId: orgId, status: { $in: PAID_STATUSES } } },
      { $unwind: "$monthsCovered" },
      { $match: { "monthsCovered.year": year } },
      { $group: { _id: "$monthsCovered.month", total: { $sum: "$amount" } } },
    ]);
    const incomeByMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
    for (const row of incomeByMonthAgg) {
      const m = Number(row._id);
      if (m >= 1 && m <= 12) incomeByMonth[m - 1].total = row.total ?? 0;
    }

    // Chart: expense per month for the given year
    const expenseByMonthAgg = await Expense.aggregate([
      { $match: { organizationId: orgId } },
      {
        $project: {
          amount: 1,
          year: { $year: "$occurredAt" },
          month: { $month: "$occurredAt" },
        },
      },
      { $match: { year } },
      { $group: { _id: "$month", total: { $sum: "$amount" } } },
    ]);
    const expenseByMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
    for (const row of expenseByMonthAgg) {
      const m = Number(row._id);
      if (m >= 1 && m <= 12) expenseByMonth[m - 1].total = row.total ?? 0;
    }

    return res.json({
      organization: { id: org._id, name: org.name, openingBalance: org.openingBalance || 0, currency: org.currency },
      period: { year, month },
      summary: {
        balance,
        incomeThisMonth,
        expenseThisMonth,
        unpaidCount,
      },
      charts: {
        incomeByMonth,
        expenseByMonth,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hr/members/unpaid?year=YYYY&month=M
 * Anggota (role member) yang belum lunas untuk bulan tersebut (Belum / Sebagian).
 */
hrRouter.get("/members/unpaid", requireAuth, requireRole("hr", "admin"), async (req, res, next) => {
  try {
    const orgId = new mongoose.Types.ObjectId(req.user.organizationId);
    const now = new Date();
    const year = parseIntOr(req.query.year, now.getFullYear());
    const month = parseIntOr(req.query.month, now.getMonth() + 1);

    const ledger = await computeMonthlyLedger({ orgId, year, month });
    const members = ledger.rows
      .filter((r) => r.role === "member" && r.status !== "Lunas")
      .map((r) => ({
        userId: r.userId,
        name: r.name,
        email: r.email,
        expected: r.expected,
        paid: Math.round(r.paid),
        status: r.status,
      }));

    res.json({
      period: { year, month },
      count: members.length,
      members,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hr/expenses?limit=100
 */
hrRouter.get("/expenses", requireAuth, requireRole("hr", "admin"), async (req, res, next) => {
  try {
    const orgId = new mongoose.Types.ObjectId(req.user.organizationId);
    const limit = Math.min(200, Math.max(1, parseIntOr(req.query.limit, 100)));

    const year = req.query.year ? parseIntOr(req.query.year, null) : null;
    const month = req.query.month ? parseIntOr(req.query.month, null) : null;
    let occurredAt = undefined;
    if (year && month) {
      const { start, end } = monthRange(year, month);
      occurredAt = { $gte: start, $lt: end };
    }

    const expenses = await Expense.find({ organizationId: orgId, ...(occurredAt ? { occurredAt } : {}) })
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ expenses });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/hr/expenses
 * body: { title, amount, occurredAt, category?, notes?, attachmentUrl? }
 */
hrRouter.post("/expenses", requireAuth, requireRole("hr", "admin"), async (req, res, next) => {
  try {
    const orgId = new mongoose.Types.ObjectId(req.user.organizationId);
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const { title, amount, occurredAt, category, notes, attachmentUrl } = req.body || {};

    if (!title || typeof title !== "string") {
      return res.status(400).json({ message: "title wajib" });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: "amount wajib > 0" });
    }
    const d = new Date(occurredAt);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ message: "occurredAt wajib (tanggal valid)" });
    }

    const doc = await Expense.create({
      organizationId: orgId,
      title: title.trim(),
      amount: Math.round(amt),
      occurredAt: d,
      category: typeof category === "string" ? category.trim() : undefined,
      notes: typeof notes === "string" ? notes.trim() : undefined,
      attachmentUrl: typeof attachmentUrl === "string" ? attachmentUrl.trim() : undefined,
      createdBy: userId,
    });

    res.status(201).json({ expense: doc });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/hr/expenses/:id
 */
hrRouter.delete("/expenses/:id", requireAuth, requireRole("hr", "admin"), async (req, res, next) => {
  try {
    const orgId = new mongoose.Types.ObjectId(req.user.organizationId);
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "id tidak valid" });
    }

    const deleted = await Expense.findOneAndDelete({ _id: new mongoose.Types.ObjectId(id), organizationId: orgId });
    if (!deleted) return res.status(404).json({ message: "Pengeluaran tidak ditemukan" });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hr/reports/links?year=YYYY&month=MM
 * Returns short-lived signed download links for browser.
 */
hrRouter.get("/reports/links", requireAuth, requireRole("hr", "admin"), async (req, res, next) => {
  try {
    const now = new Date();
    const year = parseIntOr(req.query.year, now.getFullYear());
    const month = parseIntOr(req.query.month, now.getMonth() + 1);
    const exp = Date.now() + 5 * 60 * 1000; // 5 minutes
    const dlPdf = signDownloadToken({ org: req.user.organizationId, year, month, type: "pdf", exp });
    const dlXlsx = signDownloadToken({ org: req.user.organizationId, year, month, type: "xlsx", exp });
    const dlYearly = signDownloadToken({ org: req.user.organizationId, year, type: "yearly-xlsx", exp });
    res.json({
      pdfUrl: `/api/hr/reports/monthly.pdf?dl=${encodeURIComponent(dlPdf)}`,
      xlsxUrl: `/api/hr/reports/monthly.xlsx?dl=${encodeURIComponent(dlXlsx)}`,
      yearlyXlsxUrl: `/api/hr/reports/yearly.xlsx?dl=${encodeURIComponent(dlYearly)}`,
      expiresAt: exp,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hr/reports/monthly.pdf?dl=...
 */
hrRouter.get("/reports/monthly.pdf", async (req, res, next) => {
  try {
    const payload = verifyDownloadToken(req.query.dl);
    if (!payload || payload.type !== "pdf") return res.status(403).json({ message: "Link tidak valid / kadaluarsa" });
    const orgId = new mongoose.Types.ObjectId(payload.org);
    const ledger = await computeMonthlyLedger({ orgId, year: payload.year, month: payload.month });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="rekap-${ledger.org.slug}-${payload.year}-${String(payload.month).padStart(2, "0")}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    doc.fontSize(16).text(`${ledger.org.name} — Rekap Uang Kas`, { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(12).fillColor("#555").text(`Periode: ${payload.month}/${payload.year}`);
    doc.moveDown(0.8);

    doc.fillColor("#000");
    doc.fontSize(12).text(`Pemasukan bulan ini: ${rupiah(ledger.incomeTotal)}`);
    doc.text(`Pengeluaran bulan ini: ${rupiah(ledger.expenseTotal)}`);
    doc.text(`Saldo saat ini: ${rupiah(ledger.balanceNow)}`);
    doc.moveDown(0.8);

    const startX = doc.x;
    let y = doc.y;
    const col = { no: 28, name: 210, expected: 95, paid: 95, status: 70 };

    doc.fontSize(10).fillColor("#111");
    doc.text("No", startX, y, { width: col.no });
    doc.text("Nama", startX + col.no, y, { width: col.name });
    doc.text("Iuran", startX + col.no + col.name, y, { width: col.expected, align: "right" });
    doc.text("Dibayar", startX + col.no + col.name + col.expected, y, { width: col.paid, align: "right" });
    doc.text("Status", startX + col.no + col.name + col.expected + col.paid, y, { width: col.status });
    y += 16;
    doc.moveTo(startX, y).lineTo(startX + col.no + col.name + col.expected + col.paid + col.status, y).stroke("#DDD");
    y += 8;

    doc.fontSize(10).fillColor("#000");
    ledger.rows.forEach((r, idx) => {
      if (y > 760) {
        doc.addPage();
        y = doc.y;
      }
      doc.text(String(idx + 1), startX, y, { width: col.no });
      doc.text(r.name, startX + col.no, y, { width: col.name });
      doc.text(rupiah(r.expected), startX + col.no + col.name, y, { width: col.expected, align: "right" });
      doc.text(rupiah(r.paid), startX + col.no + col.name + col.expected, y, { width: col.paid, align: "right" });
      doc.text(r.status, startX + col.no + col.name + col.expected + col.paid, y, { width: col.status });
      y += 16;
    });

    doc.end();
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hr/reports/monthly.xlsx?dl=...
 */
hrRouter.get("/reports/monthly.xlsx", async (req, res, next) => {
  try {
    const payload = verifyDownloadToken(req.query.dl);
    if (!payload || payload.type !== "xlsx") return res.status(403).json({ message: "Link tidak valid / kadaluarsa" });
    const orgId = new mongoose.Types.ObjectId(payload.org);
    const ledger = await computeMonthlyLedger({ orgId, year: payload.year, month: payload.month });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Kandara Kas Digital";
    const ws = wb.addWorksheet("Rekap");

    ws.addRow([`${ledger.org.name} — Rekap Uang Kas`]);
    ws.addRow([`Periode`, `${payload.month}/${payload.year}`]);
    ws.addRow([]);
    ws.addRow([`Pemasukan bulan ini`, ledger.incomeTotal]);
    ws.addRow([`Pengeluaran bulan ini`, ledger.expenseTotal]);
    ws.addRow([`Saldo saat ini`, ledger.balanceNow]);
    ws.addRow([]);

    const header = ["No", "Nama", "Email", "Iuran", "Dibayar", "Status"];
    ws.addRow(header);
    ws.getRow(ws.lastRow.number).font = { bold: true };

    ledger.rows.forEach((r, i) => {
      ws.addRow([i + 1, r.name, r.email, r.expected, Math.round(r.paid), r.status]);
    });

    ws.columns = [
      { width: 6 },
      { width: 28 },
      { width: 26 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
    ];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"rekap-${ledger.org.slug}-${payload.year}-${String(payload.month).padStart(2, "0")}.xlsx\"`
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hr/reports/yearly.xlsx?dl=...
 * Matrix Jan–Dec per anggota (mirip rekap WA).
 */
hrRouter.get("/reports/yearly.xlsx", async (req, res, next) => {
  try {
    const payload = verifyDownloadToken(req.query.dl);
    if (!payload || payload.type !== "yearly-xlsx") {
      return res.status(403).json({ message: "Link tidak valid / kadaluarsa" });
    }

    const orgId = new mongoose.Types.ObjectId(payload.org);
    const matrix = await computeYearlyMatrix({ orgId, year: payload.year });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Kandara Kas Digital";
    const ws = wb.addWorksheet("Rekap Tahunan");

    ws.addRow([`${matrix.org.name} — Rekap Uang Kas (Matriks)`]);
    ws.addRow([`Tahun`, String(matrix.year)]);
    ws.addRow([]);

    const monthCols = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    ws.addRow(["No", "Nama", ...monthCols, "Iuran/Bln", "Lunas (bulan)", "Total Bayar"]);
    ws.getRow(ws.lastRow.number).font = { bold: true };

    matrix.rows.forEach((r, i) => {
      const marks = r.months.map((m) => (m.ok ? "✅" : ""));
      ws.addRow([i + 1, r.name, ...marks, r.expected, r.paidCount, Math.round(r.totalPaid)]);
    });

    ws.columns = [
      { width: 6 },
      { width: 28 },
      ...Array.from({ length: 12 }, () => ({ width: 6 })),
      { width: 12 },
      { width: 12 },
      { width: 14 },
    ];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=\"rekap-${matrix.org.slug}-${matrix.year}.xlsx\"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

