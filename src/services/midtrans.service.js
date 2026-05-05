import crypto from "crypto";

const MIDTRANS_API_SANDBOX = "https://api.sandbox.midtrans.com";
const MIDTRANS_API_PRODUCTION = "https://api.midtrans.com";
const MIDTRANS_SNAP_SANDBOX = "https://app.sandbox.midtrans.com";
const MIDTRANS_SNAP_PRODUCTION = "https://app.midtrans.com";

export function getMidtransBaseUrl() {
  return process.env.MIDTRANS_IS_PRODUCTION === "true" ? MIDTRANS_API_PRODUCTION : MIDTRANS_API_SANDBOX;
}

export function getMidtransSnapBaseUrl() {
  return process.env.MIDTRANS_IS_PRODUCTION === "true" ? MIDTRANS_SNAP_PRODUCTION : MIDTRANS_SNAP_SANDBOX;
}

export function getServerKey() {
  return process.env.MIDTRANS_SERVER_KEY || "";
}

export function getClientKey() {
  return process.env.MIDTRANS_CLIENT_KEY || "";
}

/**
 * Verifikasi signature notifikasi Midtrans (Payment Notification).
 * @see https://docs.midtrans.com/docs/https-notification-webhooks
 */
export function verifyNotificationSignature(body) {
  const serverKey = getServerKey();
  if (!serverKey) return false;

  const orderId = body?.order_id;
  const statusCode = body?.status_code;
  const grossAmount = body?.gross_amount;
  if (orderId == null || statusCode == null || grossAmount == null) return false;

  const payload = String(orderId) + String(statusCode) + String(grossAmount) + serverKey;
  const expected = crypto.createHash("sha512").update(payload, "utf8").digest("hex");
  const received = body?.signature_key;
  if (!received || typeof received !== "string") return false;
  return timingSafeEqual(expected, received);
}

function timingSafeEqual(a, b) {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Contoh charge Core API (Snap / payment method sesuai payload Midtrans).
 * Panggil setelah MIDTRANS_SERVER_KEY diisi. Detail payload sesuaikan channel (VA, dsb).
 */
export async function chargeCoreApi(payload) {
  const key = getServerKey();
  if (!key) {
    throw new Error("MIDTRANS_SERVER_KEY kosong");
  }
  const base = getMidtransBaseUrl();
  const auth = Buffer.from(`${key}:`).toString("base64");
  const res = await fetch(`${base}/v2/charge`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error_messages?.join?.(", ") || data?.status_message || res.statusText;
    throw new Error(msg || "Midtrans charge gagal");
  }
  return data;
}

/**
 * Create Snap transaction (returns token + redirect_url).
 * @see https://docs.midtrans.com/docs/snap-integration
 */
export async function createSnapTransaction(payload) {
  const key = getServerKey();
  if (!key) throw new Error("MIDTRANS_SERVER_KEY kosong");
  const base = getMidtransSnapBaseUrl();
  const auth = Buffer.from(`${key}:`).toString("base64");

  const res = await fetch(`${base}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error_messages?.join?.(", ") || data?.status_message || res.statusText;
    throw new Error(msg || "Midtrans Snap gagal");
  }
  return data;
}
