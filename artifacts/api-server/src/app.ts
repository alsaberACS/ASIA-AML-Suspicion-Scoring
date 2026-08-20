import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const issues = (err as { issues?: Array<{ message: string; path: Array<string | number> }> })
      ?.issues;
    if (Array.isArray(issues)) {
      res.status(400).json({
        error: issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || "invalid request",
      });
      return;
    }
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 500) req.log.error({ err }, "request failed");
    res
      .status(statusCode)
      .json({ error: err instanceof Error ? err.message : "internal server error" });
  },
);

export default app;
