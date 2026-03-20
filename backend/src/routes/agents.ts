import { Router } from "express";
import { listCrew } from "../agents/crew.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(listCrew());
});

export default router;
