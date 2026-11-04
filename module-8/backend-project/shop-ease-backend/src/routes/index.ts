import { Router } from "express";
import { healthRouter } from "./health.routes.ts";
import { taskRouter } from "./tasks.routes.ts";
import { productRouter } from "./products.routes.ts";
import { authRouter } from "./auth.routes.ts";
import { orderRouter } from "./orders.routes.ts";

export const apiRouter: Router = Router();

apiRouter.use("/health", healthRouter);

apiRouter.use("/auth", authRouter);

apiRouter.use("/tasks", taskRouter);

apiRouter.use("/products", productRouter);

apiRouter.use("/orders", orderRouter);
