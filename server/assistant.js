import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { listProperties } from "./property-data.js";
import { createAssistant } from "./assistant-service.js";

export function assistantRouter({
  chat,
  enabled = Boolean(config.ai.apiKey && config.ai.model),
} = {}) {
  const router = Router();
  const respond =
    chat || createAssistant({ ...config.ai, search: listProperties });
  router.get("/", (req, res) => res.json({ enabled }));
  router.post(
    "/",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "Слишком много сообщений. Подождите минуту и повторите запрос.",
      },
    }),
    async (req, res) => {
      try {
        res.json(await respond(req.body?.messages));
      } catch (error) {
        // These messages are created by our service, never by the provider.
        if (error.status === 503)
          return res.status(503).json({ error: error.message });
        throw error;
      }
    },
  );
  return router;
}
