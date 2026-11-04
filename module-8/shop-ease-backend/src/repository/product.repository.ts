import { pool } from "../lib/db.ts";
import type { Product, ProductListFilters } from "../types/products.ts";
import type {
  ProductInput,
  UpdateProductInput,
} from "../validators/productValidator.ts";

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  category: string;
  image_url: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS =
  "id, name, description, price, stock, category, image_url, created_by, created_at, updated_at";

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    stock: row.stock,
    category: row.category,
    imageUrl: row.image_url,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Maps API field names to DB columns for partial updates (also acts as a whitelist).
const UPDATABLE_COLUMNS: Record<keyof ProductInput, string> = {
  name: "name",
  description: "description",
  price: "price",
  stock: "stock",
  category: "category",
  imageUrl: "image_url",
};

export async function fetchProducts(
  filters: ProductListFilters,
): Promise<{ items: Product[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(name ILIKE $${values.length} OR description ILIKE $${values.length})`,
    );
  }
  if (filters.category) {
    values.push(filters.category);
    conditions.push(`LOWER(category) = LOWER($${values.length})`);
  }
  if (filters.createdBy) {
    values.push(filters.createdBy);
    conditions.push(`created_by = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM products ${where}`,
    values,
  );

  values.push(filters.limit, (filters.page - 1) * filters.limit);
  const result = await pool.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return {
    items: result.rows.map(toProduct),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function findProductById(id: string): Promise<Product | null> {
  const result = await pool.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toProduct(row) : null;
}

export async function createDatabaseProduct(
  product: ProductInput,
  createdBy: string | null,
): Promise<Product> {
  const result = await pool.query<ProductRow>(
    `INSERT INTO products (name, description, price, stock, category, image_url, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      product.name,
      product.description,
      product.price,
      product.stock,
      product.category,
      product.imageUrl ?? null,
      createdBy,
    ],
  );
  const createdProduct = result.rows[0];
  if (!createdProduct) {
    throw new Error("Failed to create product");
  }
  return toProduct(createdProduct);
}

export async function updateDatabaseProduct(
  id: string,
  changes: UpdateProductInput,
): Promise<Product | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = changes[key as keyof ProductInput];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findProductById(id);

  values.push(id);
  const result = await pool.query<ProductRow>(
    `UPDATE products SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING ${COLUMNS}`,
    values,
  );
  const row = result.rows[0];
  return row ? toProduct(row) : null;
}

export async function deleteDatabaseProduct(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM products WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}
