import { gzip } from "node:zlib";
import type { RequestHandler } from "express";

/** Compress large inbox/history GETs, not token responses, uploads or streams. */
export const compressConversationJson: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" || !/^\/api\/conversations(?:\/|$)/.test(req.path) || !req.acceptsEncodings("gzip")) { next(); return; }
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    const text = JSON.stringify(body);
    res.vary("Accept-Encoding");
    if (!text || Buffer.byteLength(text) < 1024 || res.statusCode !== 200) return json(body);
    gzip(text, { level: 4 }, (error, bytes) => {
      if (res.destroyed || res.headersSent) return;
      if (error) { json(body); return; }
      res.type("application/json").set("Content-Encoding", "gzip").send(bytes);
    });
    return res;
  }) as typeof res.json;
  next();
};
