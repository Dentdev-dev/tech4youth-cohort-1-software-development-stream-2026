import type pg from "pg";
import { pool } from "../lib/db.ts";
import type {
  Order,
  OrderItem,
  OrderStatus,
  ShippingAddress,
} from "../types/order.ts";

type Queryable = pg.Pool | pg.PoolClient;

type OrderRow = {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_amount: number;
  shipping_address: ShippingAddress;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
};

export type LockedProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
};

const ORDER_COLUMNS =
  "id, customer_id, status, total_amount, shipping_address, notes, created_at, updated_at";

function toItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    subtotal: row.subtotal,
  };
}

function toOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    totalAmount: row.total_amount,
    shippingAddress: row.shipping_address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

/** Loads items for many orders in one query (avoids N+1). */
async function attachItems(db: Queryable, rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const result = await db.query<OrderItemRow>(
    `SELECT id, order_id, product_id, product_name, unit_price, quantity, subtotal
     FROM order_items WHERE order_id = ANY($1::uuid[])
     ORDER BY created_at`,
    [rows.map((r) => r.id)],
  );
  const byOrder = new Map<string, OrderItem[]>();
  for (const item of result.rows) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push(toItem(item));
    byOrder.set(item.order_id, list);
  }
  return rows.map((r) => toOrder(r, byOrder.get(r.id) ?? []));
}

export async function findCustomerIdByUserId(
  userId: string,
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM customers WHERE user_id = $1",
    [userId],
  );
  return result.rows[0]?.id ?? null;
}

export async function findCustomerContact(
  customerId: string,
): Promise<{ userId: string; name: string; email: string } | null> {
  const result = await pool.query<{ user_id: string; name: string; email: string }>(
    `SELECT u.id AS user_id, u.name, u.email
     FROM customers c JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [customerId],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, name: row.name, email: row.email } : null;
}

/** Locks the products' rows until the transaction ends so stock can't be oversold. */
export async function lockProducts(
  client: pg.PoolClient,
  productIds: string[],
): Promise<LockedProduct[]> {
  const result = await client.query<LockedProduct>(
    `SELECT id, name, price, stock FROM products
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [productIds],
  );
  return result.rows;
}

export async function decrementStock(
  client: pg.PoolClient,
  productId: string,
  quantity: number,
): Promise<void> {
  await client.query(
    "UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2",
    [quantity, productId],
  );
}

export async function insertOrder(
  client: pg.PoolClient,
  input: {
    customerId: string;
    totalAmount: number;
    shippingAddress: ShippingAddress;
    notes: string | null;
    items: Array<{
      productId: string;
      productName: string;
      unitPrice: number;
      quantity: number;
      subtotal: number;
    }>;
  },
): Promise<Order> {
  const orderResult = await client.query<OrderRow>(
    `INSERT INTO orders (customer_id, total_amount, shipping_address, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING ${ORDER_COLUMNS}`,
    [input.customerId, input.totalAmount, input.shippingAddress, input.notes],
  );
  const order = orderResult.rows[0];
  if (!order) throw new Error("Failed to create order");

  const items: OrderItem[] = [];
  for (const item of input.items) {
    const res = await client.query<OrderItemRow>(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, order_id, product_id, product_name, unit_price, quantity, subtotal`,
      [
        order.id,
        item.productId,
        item.productName,
        item.unitPrice,
        item.quantity,
        item.subtotal,
      ],
    );
    items.push(toItem(res.rows[0]!));
  }

  return toOrder(order, items);
}

export async function findOrders(filters: {
  customerId?: string | undefined;
  status?: OrderStatus | undefined;
  page: number;
  limit: number;
}): Promise<{ items: Order[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`customer_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const count = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM orders ${where}`,
    values,
  );

  values.push(filters.limit, (filters.page - 1) * filters.limit);
  const result = await pool.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return {
    items: await attachItems(pool, result.rows),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

export async function findOrderById(
  id: string,
  db: Queryable = pool,
  { forUpdate = false } = {},
): Promise<Order | null> {
  const result = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [id],
  );
  const [order] = await attachItems(db, result.rows);
  return order ?? null;
}

export async function setOrderStatus(
  client: pg.PoolClient,
  id: string,
  status: OrderStatus,
): Promise<void> {
  await client.query(
    "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2",
    [status, id],
  );
}

/** Puts an order's quantities back on the shelf (skips products that were deleted). */
export async function restoreStock(
  client: pg.PoolClient,
  orderId: string,
): Promise<void> {
  await client.query(
    `UPDATE products p
     SET stock = p.stock + oi.quantity, updated_at = NOW()
     FROM order_items oi
     WHERE oi.order_id = $1 AND oi.product_id = p.id`,
    [orderId],
  );
}
