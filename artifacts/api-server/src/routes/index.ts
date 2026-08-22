import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import filesRouter from "./files";
import analysisRouter from "./analysis";
import analyticsRouter from "./analytics";
import sanctionsRouter from "./sanctions";
import transactionsRouter from "./transactions";
import dashboardRouter from "./dashboard";
import disclosureRouter from "./disclosure";

const router: IRouter = Router();

router.use(healthRouter);
router.use(casesRouter);
router.use(filesRouter);
router.use(analysisRouter);
router.use(analyticsRouter);
router.use(sanctionsRouter);
router.use(transactionsRouter);
router.use(dashboardRouter);
router.use(disclosureRouter);

export default router;
