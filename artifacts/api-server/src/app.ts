import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { csrfProtection } from "./middlewares/auth";
import { appOrigin, production } from "./lib/config";
import path from "node:path";

const app: Express = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "blob:"],
      "media-src": ["'self'", "blob:"],
      "connect-src": ["'self'"],
    },
  },
}));
app.use(cors({
  credentials: true,
  origin: appOrigin || false,
}));
// Origin checks also protect login endpoints; CSRF token required on all writes.
app.use((req, res, next) => {
  if (production && !req.secure && req.path !== "/api/healthz") {
    res.status(426).json({ error: "HTTPS obligatoire." }); return;
  }
  const origin = req.get("origin");
  const host = req.get("x-forwarded-host") || req.get("host");
  if (origin && (!host || (appOrigin ? origin !== appOrigin : new URL(origin).host !== host))) {
    res.status(403).json({ error: "Origine non autorisée." }); return;
  }
  next();
});
app.use(rateLimit({ windowMs: 60000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: "Trop de requêtes, veuillez patienter." } }));
app.use(cookieParser());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api", csrfProtection);

app.use("/api", router);
app.use("/api", (_req, res) => { res.status(404).json({ error: "Route introuvable." }); });
if (process.env.SERVE_STATIC === "true") {
  const publicRoot = path.resolve(process.cwd(), "artifacts/biz-connect/dist/public");
  app.use(express.static(publicRoot, { setHeaders(res, file) {
    if (file.endsWith("sw.js") || file.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
  } }));
  app.get("/{*splat}", (_req, res) => { res.sendFile(path.join(publicRoot, "index.html")); });
}
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err: { name: err.name, message: err.message } }, "Request failed");
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.name === "MulterError" ? 400 : err.status || 500;
  res.status(status).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Fichier trop volumineux." :
    status < 500 ? err.message : "Une erreur est survenue. Veuillez réessayer." });
});

export default app;
