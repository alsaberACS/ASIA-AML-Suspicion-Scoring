import { Router, type IRouter } from "express";
import { getSanctionsIndexStatus } from "../aml/sanctions";
import {
  getSanctionsSchedulerStatus,
  kickSanctionsSweep,
} from "../aml/sanctions-scheduler";
import { h } from "./util";

const router: IRouter = Router();

router.get(
  "/sanctions/status",
  h(async (_req, res) => {
    const lists = await getSanctionsIndexStatus(4_000);
    res.json({ lists, scheduler: getSanctionsSchedulerStatus() });
  }),
);

router.post(
  "/sanctions/rescreen",
  h(async (_req, res) => {
    const started = kickSanctionsSweep();
    res.status(202).json({ started, alreadyRunning: !started });
  }),
);

export default router;
