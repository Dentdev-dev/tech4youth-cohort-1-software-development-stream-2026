-- `imageUrl` was unquoted in 002, so Postgres stored it as `imageurl`. Normalise to snake_case.
ALTER TABLE products RENAME COLUMN imageurl TO image_url;

ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE products ADD CONSTRAINT products_stock_non_negative CHECK (stock >= 0);
ALTER TABLE products ADD CONSTRAINT products_price_positive CHECK (price > 0);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);
CREATE INDEX IF NOT EXISTS products_created_by_idx ON products (created_by);
