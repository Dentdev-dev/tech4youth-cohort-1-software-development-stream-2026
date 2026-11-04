import { AppError } from "../errors/AppError.ts";
import { eventBus } from "../events/eventBus.ts";
import { withTransaction } from "../lib/db.ts";
import * as orderRepo from "../repository/order.repository.ts";
import { findUserById } from "../repository/user.repository.ts";
import type { Order, OrderStatus, ShippingAddress } from "../types/order.ts";
import type { Paginated } from "../types/products.ts";
import type { AuthUser } from "../types/user.ts";
import type {
  CreateOrderInput,
  OrderQuery,
} from "../validators/orderValidator.ts";

/** Allowed status moves. DELIVERED and CANCELLED are final. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

async function requireCustomerId(userId: string): Promise<string> {
  const customerId = await orderRepo.findCustomerIdByUserId(userId);
  if (!customerId) {
    throw new AppError(403, "Only customer accounts can place or view orders");
  }
  return customerId;
}

async function resolveShippingAddress(
  userId: string,
  provided: ShippingAddress | undefined,
): Promise<ShippingAddress> {
  if (provided) return provided;

  const user = await findUserById(userId);
  const c = user?.customer;
  if (!user || !c?.phone || !c.addressLine1 || !c.city || !c.country) {
    throw new AppError(
      400,
      "Provide a shippingAddress or complete your profile address (phone, addressLine1, city, country)",
    );
  }
  return {
    fullName: user.name,
    phone: c.phone,
    addressLine1: c.addressLine1,
    city: c.city,
    country: c.country,
    ...(c.addressLine2 ? { addressLine2: c.addressLine2 } : {}),
    ...(c.state ? { state: c.state } : {}),
    ...(c.postalCode ? { postalCode: c.postalCode } : {}),
  };
}

async function notify(
  event: "order.created" | "order.statusChanged",
  order: Order,
): Promise<void> {
  const contact = await orderRepo.findCustomerContact(order.customerId);
  if (contact) {
    eventBus.emit(event, { name: contact.name, email: contact.email, order });
  }
}

function paginate(
  result: { items: Order[]; total: number },
  q: OrderQuery,
): Paginated<Order> {
  return {
    ...result,
    page: q.page,
    limit: q.limit,
    totalPages: Math.ceil(result.total / q.limit),
  };
}

export async function placeOrder(
  userId: string,
  input: CreateOrderInput,
): Promise<Order> {
  const customerId = await requireCustomerId(userId);
  const shippingAddress = await resolveShippingAddress(
    userId,
    input.shippingAddress,
  );

  const order = await withTransaction(async (client) => {
    const products = await orderRepo.lockProducts(
      client,
      input.items.map((i) => i.productId),
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = input.items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) {
        throw new AppError(404, `Product ${item.productId} not found`);
      }
      if (product.stock < item.quantity) {
        throw new AppError(
          409,
          `Insufficient stock for "${product.name}" (available: ${product.stock})`,
        );
      }
      // Price always comes from the DB, never from the client.
      return {
        productId: product.id,
        productName: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        subtotal: round2(product.price * item.quantity),
      };
    });

    for (const line of lines) {
      await orderRepo.decrementStock(client, line.productId, line.quantity);
    }

    return orderRepo.insertOrder(client, {
      customerId,
      totalAmount: round2(lines.reduce((sum, l) => sum + l.subtotal, 0)),
      shippingAddress,
      notes: input.notes ?? null,
      items: lines,
    });
  });

  await notify("order.created", order);
  return order;
}

export async function listMyOrders(
  userId: string,
  q: OrderQuery,
): Promise<Paginated<Order>> {
  const customerId = await requireCustomerId(userId);
  return paginate(await orderRepo.findOrders({ ...q, customerId }), q);
}

export async function listAllOrders(q: OrderQuery): Promise<Paginated<Order>> {
  return paginate(await orderRepo.findOrders(q), q);
}

export async function getOrder(user: AuthUser, orderId: string): Promise<Order> {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) throw new AppError(404, "Order not found");

  if (user.role !== "ADMIN") {
    const customerId = await orderRepo.findCustomerIdByUserId(user.userId);
    // 404 rather than 403 so we don't reveal that someone else's order exists.
    if (order.customerId !== customerId) {
      throw new AppError(404, "Order not found");
    }
  }
  return order;
}

async function transition(
  orderId: string,
  next: OrderStatus,
  guard?: (order: Order) => void,
): Promise<Order> {
  const order = await withTransaction(async (client) => {
    const current = await orderRepo.findOrderById(orderId, client, {
      forUpdate: true,
    });
    if (!current) throw new AppError(404, "Order not found");
    guard?.(current);

    if (!TRANSITIONS[current.status].includes(next)) {
      throw new AppError(
        409,
        `Cannot change order status from ${current.status} to ${next}`,
      );
    }

    await orderRepo.setOrderStatus(client, orderId, next);
    if (next === "CANCELLED") await orderRepo.restoreStock(client, orderId);

    return { ...current, status: next, updatedAt: new Date() };
  });

  await notify("order.statusChanged", order);
  return order;
}

/** Customers may cancel their own order while it is still PENDING. */
export async function cancelMyOrder(
  userId: string,
  orderId: string,
): Promise<Order> {
  const customerId = await requireCustomerId(userId);
  return transition(orderId, "CANCELLED", (order) => {
    if (order.customerId !== customerId) {
      throw new AppError(404, "Order not found");
    }
    if (order.status !== "PENDING") {
      throw new AppError(409, "Only pending orders can be cancelled");
    }
  });
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<Order> {
  return transition(orderId, status);
}
