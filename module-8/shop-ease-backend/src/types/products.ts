export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  category: string;
  imageUrl: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductListFilters = {
  search?: string | undefined;
  category?: string | undefined;
  createdBy?: string | undefined;
  page: number;
  limit: number;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};
