import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import filesRouter from "./files";
import analysisRouter from "./analysis";
import transactionsRouter from "./transactions";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(casesRouter);
router.use(filesRouter);
router.use(analysisRouter);
router.use(transactionsRouter);
router.use(dashboardRouter);

export default router;
