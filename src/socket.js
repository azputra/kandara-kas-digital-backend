import { Server } from "socket.io";

/** @type {import("socket.io").Server | null} */
let ioRef = null;

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.on("connection", (socket) => {
    socket.on("join", (payload, cb) => {
      const orgId = payload?.organizationId;
      if (!orgId || typeof orgId !== "string") {
        cb?.({ ok: false });
        return;
      }
      socket.join(`org:${orgId}`);
      cb?.({ ok: true });
    });
  });

  ioRef = io;
  return io;
}

export function getIo() {
  return ioRef;
}
