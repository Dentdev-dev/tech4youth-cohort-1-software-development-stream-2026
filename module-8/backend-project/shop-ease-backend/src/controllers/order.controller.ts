import type { Request, Response } from "express";
import * as orderService from "../services/order.service.ts";
import type { OrderQuery } from "../validators/orderValidator.ts";

type IdParams = { id: string };

export async function createOrder(req: Request, res: Response): Promise<void> {
  const order = await orderService.placeOrder(req.user!.userId, req.body);
  res.status(201).json({ success: true, data: order });
}

export async function getMyOrders(req: Request, res: Response): Promise<void> {
  const orders = await orderService.listMyOrders(
    req.user!.userId,
    req.query as unknown as OrderQuery,
  );
  res.status(200).json({ success: true, data: orders });
}

export async function getAllOrders(req: Request, res: Response): Promise<void> {
  const orders = await orderService.listAllOrders(
    req.query as unknown as OrderQuery,
  );
  res.status(200).json({ success: true, data: orders });
}

export async function getOrderById(
  req: Request<IdParams>,
  res: Response,
): Promise<void> {
  const order = await orderService.getOrder(req.user!, req.params.id);
  res.status(200).json({ success: true, data: order });
}

export async function cancelOrder(
  req: Request<IdParams>,
  res: Response,
): Promise<void> {
  const order = await orderService.cancelMyOrder(req.user!.userId, req.params.id);
  res.status(200).json({ success: true, data: order });
}

export async function updateOrderStatus(
  req: Request<IdParams>,
  res: Response,
): Promise<void> {
  const order = await orderService.updateOrderStatus(
    req.params.id,
    req.body.status,
  );
  res.status(200).json({ success: true, data: order });
}
