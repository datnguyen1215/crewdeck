import { Router } from "express";
import { listCrew, listAllCrew } from "../orchestration/crew.js";
import { requireScope } from "../middleware/scope.js";
import { Scope } from "../constants/scopes.js";

const router = Router();

router.get("/", requireScope(Scope.AGENTS_READ), (req, res) => {
  const all = req.query.all === "true";
  res.json(all ? listAllCrew() : listCrew());
});

export default router;
