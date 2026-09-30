import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { requireAuth, notFound } from "./security.js";
import { id } from "./validation.js";
import { imageView } from "./property-data.js";

const allowedMime = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10, fields: 0, parts: 10 },
  fileFilter: (req, file, cb) => {
    if (!allowedMime[file.mimetype])
      return cb(
        Object.assign(new Error("Допустимы только JPEG, PNG и WebP"), {
          status: 422,
        }),
      );
    cb(null, true);
  },
});
export const uploadLimit = () =>
  rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Слишком много загрузок. Подождите минуту." },
  });
export async function prepareImage(file, avatar = false) {
  if (!file)
    throw Object.assign(new Error("Выберите изображение"), { status: 422 });
  let buffer;
  try {
    const image = sharp(file.buffer, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
      animated: false,
    });
    const meta = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format) ||
      allowedMime[file.mimetype] !== meta.format ||
      (meta.pages || 1) > 1 ||
      !meta.width ||
      !meta.height
    )
      throw new Error("Invalid image");
    buffer = await image
      .rotate()
      .resize(avatar ? 400 : 1800, avatar ? 400 : 1400, {
        fit: avatar ? "cover" : "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throw Object.assign(
      new Error(
        "Файл повреждён или не является допустимым изображением JPEG, PNG или WebP",
      ),
      { status: 422 },
    );
  }
  const filename = `${randomUUID()}.webp`;
  await mkdir(config.uploadDir, { recursive: true });
  await writeFile(path.join(config.uploadDir, filename), buffer, {
    flag: "wx",
  });
  return filename;
}
export async function removeFiles(names) {
  await Promise.all(
    names.map(async (name) => {
      if (!/^[a-f0-9-]+\.webp$/.test(name)) return;
      try {
        await unlink(path.join(config.uploadDir, name));
      } catch (err) {
        if (err.code !== "ENOENT")
          console.error("Image cleanup failed:", err.code);
      }
    }),
  );
}
export function uploadsRouter() {
  const router = Router();
  const checkOwner = async (req, res, next) => {
    if (
      !(
        await pool.query(
          "SELECT 1 FROM properties WHERE id=$1 AND owner_id=$2",
          [id(req.params.id), req.session.userId],
        )
      ).rowCount
    )
      throw notFound();
    next();
  };
  router.post(
    "/properties/:id/images",
    requireAuth,
    checkOwner,
    uploadLimit(),
    upload.array("images", 10),
    async (req, res) => {
      if (!req.files?.length)
        return res
          .status(422)
          .json({ error: "Выберите хотя бы одну фотографию" });
      const files = [];
      try {
        for (const file of req.files) files.push(await prepareImage(file));
        const images = await transaction(async (client) => {
          if (
            !(
              await client.query(
                "SELECT id FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE",
                [id(req.params.id), req.session.userId],
              )
            ).rowCount
          )
            throw notFound();
          const rows = (
            await client.query(
              "SELECT id,filename,position FROM property_images WHERE property_id=$1 ORDER BY position,id",
              [id(req.params.id)],
            )
          ).rows;
          if (rows.length + files.length > 10)
            throw Object.assign(
              new Error("У объекта может быть не более 10 фотографий"),
              { status: 422 },
            );
          let pos = rows.length
            ? Math.max(...rows.map((r) => r.position)) + 1
            : 0;
          for (const filename of files)
            rows.push(
              (
                await client.query(
                  "INSERT INTO property_images(property_id,filename,position) VALUES($1,$2,$3) RETURNING id,filename,position",
                  [id(req.params.id), filename, pos++],
                )
              ).rows[0],
            );
          return rows.map(imageView);
        });
        res.status(201).json({ images });
      } catch (err) {
        await removeFiles(files);
        throw err;
      }
    },
  );
  router.delete(
    "/properties/:id/images/:imageId",
    requireAuth,
    async (req, res) => {
      const filename = await transaction(async (client) => {
        const property = (
          await client.query(
            "SELECT status FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [id(req.params.id), req.session.userId],
          )
        ).rows[0];
        if (!property) throw notFound();
        const image = (
          await client.query(
            "SELECT filename FROM property_images WHERE id=$1 AND property_id=$2",
            [id(req.params.imageId), id(req.params.id)],
          )
        ).rows[0];
        if (!image) throw notFound();
        const count = Number(
          (
            await client.query(
              "SELECT count(*) FROM property_images WHERE property_id=$1",
              [id(req.params.id)],
            )
          ).rows[0].count,
        );
        if (property.status === "published" && count === 1)
          throw Object.assign(
            new Error(
              "У опубликованного объекта должна остаться хотя бы одна фотография",
            ),
            { status: 422 },
          );
        await client.query("DELETE FROM property_images WHERE id=$1", [
          id(req.params.imageId),
        ]);
        return image.filename;
      });
      await removeFiles([filename]);
      res.sendStatus(204);
    },
  );
  return router;
}
export async function serveMedia(req, res, next) {
  const name = req.params.filename;
  if (!/^[a-f0-9-]{36}\.webp$/.test(name)) throw notFound();
  const allowed = await pool.query(
    `SELECT 1 FROM property_images i JOIN properties p ON p.id=i.property_id WHERE i.filename=$1 AND (p.status='published' OR p.owner_id=$2)
    UNION ALL SELECT 1 FROM users WHERE avatar_filename=$1 LIMIT 1`,
    [name, req.session.userId || null],
  );
  if (!allowed.rowCount) throw notFound();
  // Revalidate every request: unpublishing must immediately revoke public access.
  res.set("Cache-Control", "private, no-store");
  res.type("webp");
  res.sendFile(name, { root: config.uploadDir, dotfiles: "deny" }, (err) => {
    if (err) next(err);
  });
}
