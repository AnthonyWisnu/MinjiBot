import { Router, type Request, type Response } from "express";

import { streamingService } from "../services/streaming.service";

export const streamRouter = Router();

// GET /api/player/stream/:sessionId - Secure HTTP range streaming
streamRouter.get("/api/player/stream/:sessionId", async (req: Request, res: Response) => {
  const rawId = req.params.sessionId;
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!sessionId) {
    res.status(400).json({ error: "Session ID tidak valid." });
    return;
  }
  await streamingService.streamSession(sessionId, req, res);
});

// GET /api/stream/:sessionId - Backward compatible stream route
streamRouter.get("/api/stream/:sessionId", async (req: Request, res: Response) => {
  const rawId = req.params.sessionId;
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!sessionId) {
    res.status(400).json({ error: "Session ID tidak valid." });
    return;
  }
  await streamingService.streamSession(sessionId, req, res);
});
