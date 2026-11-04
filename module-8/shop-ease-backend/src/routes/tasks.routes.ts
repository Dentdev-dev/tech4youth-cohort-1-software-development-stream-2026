import { Router } from "express";
import * as taskControler from "../controllers/task.controller.ts";

export const taskRouter: Router = Router();

taskRouter.get("/", taskControler.getAllTasks);
taskRouter.get("/:id", taskControler.getTaskById);
taskRouter.post("/", taskControler.createTask);
taskRouter.patch("/:id", taskControler.updateTask);
taskRouter.delete("/:id", taskControler.deleteTask);
