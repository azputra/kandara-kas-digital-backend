import "dotenv/config";
import http from "http";
import { createApp } from "./app.js";
import { connectDb } from "./config/db.js";
import { initSocket } from "./socket.js";

const port = Number(process.env.PORT) || 4000;

await connectDb();

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);
app.set("io", io);

server.listen(port, () => {
  console.log(`API Kandara Kas Digital listening on http://127.0.0.1:${port}`);
});
