export const ORDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type ShippingAddress = {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state?: string | undefined;
  postalCode?: string | undefined;
  country: string;
};

export type OrderItem = {
  id: string;
  productId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  totalAmount: number;
  shippingAddress: ShippingAddress;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItem[];
};
