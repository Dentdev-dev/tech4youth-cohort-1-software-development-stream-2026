# ShopEase PostgreSQL: Beginner's Guide to Terminal Commands and Setup

**Audience:** Students learning PostgreSQL for the first time  
**Project:** ShopEase e-commerce database  
**Environment:** Windows PowerShell and PostgreSQL 14+  
**Based on:** The supplied *ShopEase PostgreSQL setup: student guide* (`README.md`).

## 1. What are we trying to do?

ShopEase needs a PostgreSQL database named `shopease` to store products and, later, customers and orders. The setup uses three SQL files:

| File | Purpose | PostgreSQL login |
|---|---|---|
| `00_create_database.sql` | Create the database and the application's database login | `postgres` |
| `01_schema.sql` | Create schemas, tables, keys, indexes and other database structures | `shopease_app` |
| `02_seed_products.sql` | Insert or update the example products and categories | `shopease_app` |

The original guide describes 20 products across four categories: Beauty, Electronics, Fashion and Home. These SQL files must be present in your working folder. This guide explains how to **run** them; it does not recreate their contents.

### The connection flow

```text
PowerShell terminal
    |
    | runs psql commands
    v
PostgreSQL server (usually localhost:5432)
    |
    +-- database: postgres (used for initial administration)
    |
    +-- database: shopease
            |
            +-- schema: users
            +-- schema: products
            +-- schema: orders
```

**Important:** `postgres` can mean a database administrator *role* or the default administrative *database*. They happen to share a name, but they are different things.

## 2. What is a terminal command?

A terminal lets you give instructions to your computer by typing text. For example:

```powershell
psql --version
```

This asks the installed PostgreSQL command-line tool to show its version. You type the command into **PowerShell**, then press **Enter**.

A command often has this pattern:

```text
program  option value  option value
```

For example:

```powershell
psql -U shopease_app -d shopease
```

- `psql` is the **program** being run.
- `-U` is an **option**, also called a *flag*, telling `psql` that the next text is a database username.
- `shopease_app` is the **value** supplied to `-U`.
- `-d` is an option for the database name.
- `shopease` is the value supplied to `-d`.

Options are not SQL statements. They are instructions to the `psql` program about how to connect or what to execute.

## 3. The four most important `psql` options

### `-U` — username

**Long form:** `--username`

```powershell
psql -U postgres
```

**Meaning:** Connect using the PostgreSQL role named `postgres`.

```powershell
psql -U shopease_app
```

**Meaning:** Connect using the application role named `shopease_app`.

**Remember:** `-U` is a capital **U**. It is not the Windows username, and it does not create a user. The role must already exist.

### `-d` — database

**Long form:** `--dbname`

```powershell
psql -U shopease_app -d shopease
```

**Meaning:** Log in as `shopease_app` and open the database named `shopease`.

Why do we use `-d postgres` in the first command? Because the `shopease` database has not yet been created. We first connect to the existing `postgres` database to run the creation script.

### `-f` — file

**Long form:** `--file`

```powershell
psql -U shopease_app -d shopease -f .\01_schema.sql
```

**Meaning:** Connect to `shopease`, open the local file `01_schema.sql`, and execute the SQL statements in that file.

The file path must point to a real file. `-f` does **not** create the file and does **not** mean "folder".

A helpful mental model: `-f` is like saying, "Read the instructions from this document and carry them out."

### `-c` — command

**Long form:** `--command`

```powershell
psql -U shopease_app -d shopease -c "SELECT current_database();"
```

**Meaning:** Connect to `shopease`, run the SQL written inside the quotes, show the result, and exit.

The quotes keep the SQL text together as one argument in PowerShell.

**Difference between `-f` and `-c`:**

| Option | Where does SQL come from? | Best used for |
|---|---|---|
| `-f` | A `.sql` file on disk | Running a schema or seed script |
| `-c` | SQL typed directly in the terminal | Running one quick query |

## 4. Other symbols and options you will see

| Text | Meaning | Example |
|---|---|---|
| `psql` | PostgreSQL command-line client | `psql --version` |
| `--version` | Display installed client version | `psql --version` |
| `-h` | Server host/address | `-h localhost` |
| `-p` | Server port | `-p 5432` |
| `-W` | Ask for a password before connecting | `psql -W -U postgres -d postgres` |
| `-v ON_ERROR_STOP=1` | Stop processing a script when a SQL error occurs | `psql -v ON_ERROR_STOP=1 -f .\01_schema.sql` |
| `.` | Current directory (in a path) | `.\01_schema.sql` |
| `.\` | "Inside the folder I am currently in" (Windows path syntax) | `.\02_seed_products.sql` |
| `\` | Windows path separator | `folder\file.sql` |
| `.sql` | File extension commonly used for SQL scripts | `01_schema.sql` |
| `"..."` | Groups SQL or a path with spaces into one argument | `-c "SELECT 1;"` |
| `;` | Ends a SQL statement | `SELECT 1;` |
| `cd` | Change directory in PowerShell | `cd "C:\path\to\postgres"` |
| `dir` | Show files in the current PowerShell folder | `dir` |
| `\q` | Quit an interactive `psql` session | `\q` |
| `\dt` | Show tables visible in the current schema search path | `\dt` |
| `\dt products.*` | Show tables in the `products` schema | `\dt products.*` |
| `\dn` | Show schemas | `\dn` |
| `\l` | List databases | `\l` |
| `\conninfo` | Show current connection details | `\conninfo` |

**Do not confuse `-p` with `-W`:** `-p` means **port**, not password. You should not type a database password directly into your command history. `-W` prompts for it securely (your typing may not appear on screen).

**Also:** `\q`, `\dt`, `\dn`, and `\l` are `psql` **meta-commands**. Run them *inside* an interactive `psql` session, not at the normal PowerShell prompt.

## 5. Full breakdown of the first setup command

```powershell
psql -U postgres -d postgres -f .\00_create_database.sql
```

Read it from left to right:

1. **`psql`** — open the PostgreSQL command-line client.
2. **`-U postgres`** — authenticate as the database administrator role `postgres`.
3. **`-d postgres`** — connect to the already existing administrative database called `postgres`.
4. **`-f .\00_create_database.sql`** — execute the SQL file found in the current folder.

**In plain English:** "Using the PostgreSQL administrator account, connect to the existing admin database and run the file that creates ShopEase's database and application role."

When asked for a password, use the **administrator password selected during PostgreSQL installation**.

The original README says this script creates the role `shopease_app` and database `shopease`. Run it only for initial setup; it is not a script to repeatedly execute.

### Why `postgres` appears twice

```text
-U postgres  = WHO am I connecting as? (role)
-d postgres  = WHICH database am I opening? (database)
```

These are different concepts, even though their names are identical.

## 6. Full breakdown of the schema command

```powershell
psql -U shopease_app -d shopease -f .\01_schema.sql
```

1. `psql` — start the client.
2. `-U shopease_app` — use the application database role.
3. `-d shopease` — open the ShopEase database.
4. `-f .\01_schema.sql` — execute the script that builds the database structure.

**In plain English:** "Sign in as the ShopEase database application role, open the ShopEase database, and create its tables and other structures."

When prompted, use the password assigned to `shopease_app` in `00_create_database.sql`, **not** the administrator password.

The project uses these PostgreSQL schemas:

- `users` — application accounts and addresses.
- `products` — product categories and products.
- `orders` — orders, order items, and order addresses.

A **schema** is a namespace inside a database. `products.products` means `schema_name.table_name`; it is not a typo.

## 7. Full breakdown of the seed command

```powershell
psql -U shopease_app -d shopease -f .\02_seed_products.sql
```

This uses the **same database role and database** as the previous command, but a **different SQL file**.

- `01_schema.sql` creates the structures (the empty shelves).
- `02_seed_products.sql` fills the product tables with initial example data (the books placed on those shelves).

According to the supplied README, the seed contains **20 products** across **four categories**, five products per category. The guide describes the schema and seed scripts as safe to rerun during development.

## 8. Full breakdown of the verification command

The original guide checks how many products belong to each category:

```powershell
psql -U shopease_app -d shopease -c "SELECT c.name AS category, count(*) AS product_count FROM products.products AS p JOIN products.categories AS c ON c.id = p.category_id GROUP BY c.name ORDER BY c.name;"
```

The connection part is already familiar:

```text
psql -U shopease_app -d shopease
```

The new part is `-c "..."`, which runs SQL directly. The SQL inside means:

| SQL fragment | Beginner explanation |
|---|---|
| `SELECT` | Choose the information to display |
| `c.name` | Read the category's `name` column |
| `AS category` | Display that column under the heading `category` |
| `count(*)` | Count matching rows |
| `AS product_count` | Name the count column `product_count` |
| `FROM products.products AS p` | Start from the products table and call it `p` for short |
| `JOIN products.categories AS c` | Include matching rows from the categories table, shortened to `c` |
| `ON c.id = p.category_id` | Match each product to its category |
| `GROUP BY c.name` | Put rows into groups based on category name |
| `ORDER BY c.name` | Sort the result by category name |
| `;` | End the SQL statement |

**Expected counts from the supplied guide:** Beauty 5, Electronics 5, Fashion 5, Home 5.

### Easier queries to try first

Check which database you opened:

```powershell
psql -U shopease_app -d shopease -c "SELECT current_database();"
```

Count all products:

```powershell
psql -U shopease_app -d shopease -c "SELECT COUNT(*) FROM products.products;"
```

Show five product names:

```powershell
psql -U shopease_app -d shopease -c "SELECT name FROM products.products LIMIT 5;"
```

These queries are **read-only**: they retrieve information without changing records.

## 9. Installing and preparing PostgreSQL on Windows

### Step A: Install and start the service

Install PostgreSQL **14 or later**, as required by the supplied README. During setup, choose a password for the `postgres` administrator role and keep it private. Make sure the PostgreSQL service is running.

### Step B: Open PowerShell

Open PowerShell or the VS Code integrated terminal set to PowerShell, then type:

```powershell
psql --version
```

If PowerShell says `psql` is not recognized, its executable may not be in your Windows PATH. The README suggests adding the PostgreSQL `bin` directory, such as `C:\Program Files\PostgreSQL\16\bin` for a version 16 installation, or opening the installed **SQL Shell (psql)**. Use your actual installed version number.

### Step C: Go to the SQL files folder

Use `cd` with the **actual path on your computer**:

```powershell
cd "C:\path\to\your\project\postgres"
```

The path in the supplied README is specific to its author's computer; do not copy it unchanged unless that folder really exists on your machine.

List the files:

```powershell
dir
```

You should see these files before continuing:

```text
00_create_database.sql
01_schema.sql
02_seed_products.sql
```

### Step D: Choose the application role password

Open `00_create_database.sql` and locate:

```sql
PASSWORD 'replace-this-with-a-strong-secret'
```

Replace the placeholder with a **new private password**. The README uses an illustrative password, but do not reuse it. Do not commit real passwords to Git or share the modified file publicly.

### Step E: Run the three scripts in order

```powershell
# 1. Create database and role (administrator password)
psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f .\00_create_database.sql

# 2. Create schemas and tables (application-role password)
psql -v ON_ERROR_STOP=1 -U shopease_app -d shopease -f .\01_schema.sql

# 3. Load example products (application-role password)
psql -v ON_ERROR_STOP=1 -U shopease_app -d shopease -f .\02_seed_products.sql
```

**Why is `-v ON_ERROR_STOP=1` included here?** It is an optional safety improvement beyond the README's basic commands. `-v` sets a `psql` variable, and `ON_ERROR_STOP=1` makes `psql` stop processing a file when SQL fails. This makes failures easier for students to spot. It does **not** automatically undo earlier successful SQL statements in the file.

**Important:** Only proceed to the next step when the previous command succeeded. Do not rerun the first creation script after it has already created the role/database.

### Step F: Verify

```powershell
psql -U shopease_app -d shopease -c "SELECT COUNT(*) FROM products.products;"
```

Expected result after successful seeding: `20`.

## 10. Interactive mode versus one-off mode

### One-off mode (`-c`)

```powershell
psql -U shopease_app -d shopease -c "SELECT COUNT(*) FROM products.products;"
```

The client connects, runs one command, prints its result, and exits back to PowerShell.

### Interactive mode (no `-c` or `-f`)

```powershell
psql -U shopease_app -d shopease
```

You now see a prompt similar to:

```text
shopease=>
```

Type SQL and press Enter:

```sql
SELECT id, name, price
FROM products.products
ORDER BY id
LIMIT 5;
```

The query executes when the statement is complete (typically when you type the final semicolon). Useful interactive commands:

```text
\conninfo          Show current connection
\dn                List schemas
\dt products.*     List product-schema tables
\dt users.*        List user-schema tables
\dt orders.*       List order-schema tables
\q                 Quit psql and return to PowerShell
```

**Common mistake:** Typing `psql -U ...` *inside* an already open `psql` prompt. That is a PowerShell command, not SQL. Use `\q` first, then run the connection command from PowerShell.

## 11. Understanding the three types of users and passwords

| Identity | Used by | Password source |
|---|---|---|
| `postgres` | Database administrator | Chosen during PostgreSQL installation |
| `shopease_app` | ShopEase backend/database scripts | Chosen in the creation SQL script |
| ShopEase customer | Someone logging into the website | Chosen at registration; backend stores a password hash |

**The React frontend must not contain PostgreSQL credentials.** In a real application, React sends HTTP requests to the backend. The backend uses the `shopease_app` role to connect to PostgreSQL. Customer passwords are different and should be hashed by the backend before storage.

## 12. Common errors and how to fix them

### Error: `psql` is not recognized

**Cause:** PostgreSQL command-line tools are not installed or are not on PATH.

**Fix:** Confirm installation, use SQL Shell (psql), or add the correct PostgreSQL `bin` directory to PATH. Open a new PowerShell window afterward.

### Error: `connection refused` or `could not connect to server`

**Cause:** The PostgreSQL service may not be running, or host/port may be wrong.

**Fix:** Start the service. For a standard local installation, try:

```powershell
psql -h localhost -p 5432 -U postgres -d postgres
```

### Error: `password authentication failed for user ...`

**Cause:** Wrong password for the selected role.

**Fix:** Check `-U`. For `postgres`, use the installer password. For `shopease_app`, use the password set when that role was created.

### Error: `role "shopease_app" does not exist`

**Cause:** The creation script has not successfully created the application role.

**Fix:** Review the output from `00_create_database.sql`. Do not proceed to the schema script until the role and database exist.

### Error: `database "shopease" does not exist`

**Cause:** The database creation step did not complete, or the name is mistyped.

**Fix:** Connect as `postgres` and check `\l` in interactive `psql`.

### Error: `No such file or directory` / file cannot be opened

**Cause:** The `-f` file path is wrong or you are in the wrong folder.

**Fix:** Run `dir`, check the filename, and use `cd` to open the correct directory. Alternatively, supply an absolute path in quotes.

### Error: `relation "products.products" does not exist`

**Cause:** The schema script has not completed successfully, or you connected to the wrong database.

**Fix:** Run `SELECT current_database();`, then inspect `\dt products.*` in interactive mode. Review errors from the schema script.

### Error: `role ... already exists` or `database ... already exists`

**Cause:** You may have already run the one-time creation script.

**Fix:** Do not rerun it blindly. Verify the existing role/database, then proceed with the schema/seed steps if the setup is correct. A partially completed bootstrap may need instructor assistance.

### Error: `permission denied`

**Cause:** The role does not have the required privileges or the objects belong to another role.

**Fix:** Confirm you used the intended role for each file (`postgres` for bootstrap, `shopease_app` for schema and seed). Do not grant superuser privileges just to silence the error.

## 13. Practice exercises

Complete these in order. Write down the meaning of every option before running each command.

1. Display the installed PostgreSQL client version.
2. Connect interactively to the `shopease` database using `shopease_app`.
3. Find out which database you are connected to.
4. List the schemas in the database.
5. List the tables in the `products` schema.
6. Count all products using `-c` from PowerShell.
7. Display the first five product names and prices.
8. Explain why the bootstrap command uses `-U postgres -d postgres`.
9. Explain the difference between `-f` and `-c` in your own words.
10. Explain why the database password must never be placed in React code.

### Suggested answers for the command exercises

```powershell
# 1
psql --version

# 2
psql -U shopease_app -d shopease

# 6 (run from PowerShell, after leaving interactive mode)
psql -U shopease_app -d shopease -c "SELECT COUNT(*) FROM products.products;"

# 7
psql -U shopease_app -d shopease -c "SELECT name, price FROM products.products ORDER BY id LIMIT 5;"
```

Inside interactive `psql`, exercise 3 uses `SELECT current_database();` or `\conninfo`, exercise 4 uses `\dn`, and exercise 5 uses `\dt products.*`.

## 14. Quick-reference cheat sheet

```powershell
# Check PostgreSQL client installation
psql --version

# Connect as admin to the default admin database
psql -U postgres -d postgres

# Create ShopEase database and application role (first setup only)
psql -U postgres -d postgres -f .\00_create_database.sql

# Build ShopEase tables and related database structures
psql -U shopease_app -d shopease -f .\01_schema.sql

# Import example products
psql -U shopease_app -d shopease -f .\02_seed_products.sql

# Count products without entering interactive mode
psql -U shopease_app -d shopease -c "SELECT COUNT(*) FROM products.products;"

# Open an interactive session
psql -U shopease_app -d shopease
```

| Flag | Remember it as | What it controls |
|---|---|---|
| `-U` | **U**sername | Who connects |
| `-d` | **D**atabase | Which database opens |
| `-f` | **F**ile | Which SQL file runs |
| `-c` | **C**ommand | Which inline SQL runs |
| `-h` | **H**ost | Which computer/server to connect to |
| `-p` | **P**ort | Which network port to use |
| `-W` | Password prompt | Ask for a password before connecting |

**Final reminder:** First choose **who** you are (`-U`), then **where** you are working (`-d`), then **what** you want to execute (`-f` or `-c`). That simple pattern explains most of the ShopEase setup commands.
