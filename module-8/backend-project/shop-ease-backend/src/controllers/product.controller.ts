import type { Request, Response } from "express";
import * as productService from "../services/product.service.ts";
import type { ProductQuery } from "../validators/productValidator.ts";

export async function getAllProducts(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.query as unknown as ProductQuery;
  const products = await productService.listProducts(query);
  res.status(200).json({ success: true, data: products });
}

export async function getAllProductsByUserId(
  req: Request<{ userId: string }>,
  res: Response,
): Promise<void> {
  const query = req.query as unknown as ProductQuery;
  const products = await productService.listProducts({
    ...query,
    createdBy: req.params.userId,
  });
  res.status(200).json({ success: true, data: products });
}

export async function getProductById(
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const product = await productService.getProduct(req.params.id);
  res.status(200).json({ success: true, data: product });
}

export async function createProduct(
  req: Request,
  res: Response,
): Promise<void> {
  const product = await productService.createProduct(
    req.body,
    req.user!.userId,
  );
  res.status(201).json({ success: true, data: product });
}

export async function updateProduct(
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const product = await productService.updateProduct(req.params.id, req.body);
  res.status(200).json({ success: true, data: product });
}

export async function deleteProduct(
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  await productService.deleteProduct(req.params.id);
  res.status(204).send(); // 204 = success, no content
}
