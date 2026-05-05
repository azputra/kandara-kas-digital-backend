import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Token diperlukan" });
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET belum di-set");
    const decoded = jwt.verify(token, secret);
    req.user = { id: decoded.sub, role: decoded.role, organizationId: decoded.organizationId };
    next();
  } catch {
    return res.status(401).json({ message: "Token tidak valid" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Tidak terautentikasi" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Akses ditolak" });
    }
    next();
  };
}
