import { Router } from "express";
import * as orderController from "../controllers/order.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { requireAdmin } from "../middlewares/admin.middleware.ts";
import { validate } from "../middlewares/validate.ts";
import { idParamSchema } from "../validators/common.ts";
import {
  createOrderSchema,
  orderQuerySchema,
  updateOrderStatusSchema,
} from "../validators/orderValidator.ts";

export const orderRouter: Router = Router();

orderRouter.use(authenticate);

// Customer
orderRouter.post("/", validate(createOrderSchema), orderController.createOrder);
orderRouter.get(
  "/me",
  validate(orderQuerySchema, "query"),
  orderController.getMyOrders,
);
orderRouter.patch(
  "/:id/cancel",
  validate(idParamSchema, "params"),
  orderController.cancelOrder,
);

// Admin
orderRouter.get(
  "/",
  requireAdmin,
  validate(orderQuerySchema, "query"),
  orderController.getAllOrders,
);
orderRouter.patch(
  "/:id/status",
  requireAdmin,
  validate(idParamSchema, "params"),
  validate(updateOrderStatusSchema),
  orderController.updateOrderStatus,
);

// Owner or admin
orderRouter.get(
  "/:id",
  validate(idParamSchema, "params"),
  orderController.getOrderById,
);
