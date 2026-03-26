import { Router } from "express";
import { listCrew, listAllCrew } from "../orchestration/crew.js";

const router = Router();

router.get("/", (req, res) => {
  const all = req.query.all === "true";
  res.json(all ? listAllCrew() : listCrew());
});

export default router;
