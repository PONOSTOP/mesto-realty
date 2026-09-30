import "dotenv/config";
import path from "node:path";

const production = process.env.NODE_ENV === "production";
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32)
  throw new Error(
    "SESSION_SECRET должен содержать минимум 32 символа. См. .env.example",
  );
if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
if (production && !origin.startsWith("https://"))
  throw new Error("В production APP_ORIGIN должен использовать HTTPS");
export const config = {
  production,
  secret,
  origin: new URL(origin).origin,
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "./uploads"),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
};
