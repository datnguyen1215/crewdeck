import { Router } from "express";
import { listCrew, listAllCrew } from "../orchestration/crew.js";

const router = Router();

router.get("/", (req, res) => {
  // Use ?all to include non-dispatchable agents (captain)
  const includeAll = req.query.all !== undefined;
  res.json(includeAll ? listAllCrew() : listCrew());
});

export default router;
