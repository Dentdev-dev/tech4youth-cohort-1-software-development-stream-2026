import { AppError } from "../errors/AppError.ts";
import {
  createDatabaseProduct,
  deleteDatabaseProduct,
  fetchProducts,
  findProductById,
  updateDatabaseProduct,
} from "../repository/product.repository.ts";
import type {
  Paginated,
  Product,
  ProductListFilters,
} from "../types/products.ts";
import type {
  ProductInput,
  UpdateProductInput,
} from "../validators/productValidator.ts";

export async function listProducts(
  filters: ProductListFilters,
): Promise<Paginated<Product>> {
  const { items, total } = await fetchProducts(filters);
  return {
    items,
    total,
    page: filters.page,
    limit: filters.limit,
    totalPages: Math.ceil(total / filters.limit),
  };
}

export async function getProduct(id: string): Promise<Product> {
  const product = await findProductById(id);
  if (!product) throw new AppError(404, "Product not found");
  return product;
}

export async function createProduct(
  input: ProductInput,
  createdBy: string,
): Promise<Product> {
  return createDatabaseProduct(input, createdBy);
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<Product> {
  const product = await updateDatabaseProduct(id, input);
  if (!product) throw new AppError(404, "Product not found");
  return product;
}

export async function deleteProduct(id: string): Promise<void> {
  const deleted = await deleteDatabaseProduct(id);
  if (!deleted) throw new AppError(404, "Product not found");
}
