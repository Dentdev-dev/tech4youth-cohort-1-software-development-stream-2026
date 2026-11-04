# Authentication, Authorisation and Web Security in Express with TypeScript

**Format:** 3-hour, project-based session. **Project:** TaskVault, a multi-user task API.

**Assumptions.** The attached brief still carried React and Vite wording in its learner profile and technical constraints, so I replaced those with the Express and TypeScript equivalents: all code is `.ts`, bridges compare to Node and Express patterns, and "where this fits" refers to the backend path. Learners can write Express routes and middleware, and they can read basic SQL. The project uses SQLite so nobody needs a database server, and session data lives in memory because production stores belong in a later lesson. Commands assume macOS, Linux or Git Bash.

> **Version note: tested stack.** All project code in this document was type-checked and run on 4 November 2026 with Node 22.23: Express 5.3, TypeScript 7.0, tsx 4.23, express-session 1.19, argon2 0.45, jose 6.2, openid-client 6.8, helmet 8.3, express-rate-limit 8.7, zod 4.6, better-sqlite3 13.0 and oauth2-mock-server 9.3. Security libraries move quickly, so check these again before you teach.

---

## 1. Learning objectives

By the end, learners will be able to:

1. **Explain** the difference between authentication and authorisation, and return the correct `401`, `403` or `404` for a given request.
2. **Build** password registration, login and logout using Argon2id and server-side sessions with correctly configured cookies.
3. **Implement** JWT issuing and verification with `jose`, and an OpenID Connect login with `openid-client`, and justify when to use sessions or tokens.
4. **Exploit and then fix** broken ownership checks, SQL injection, mass assignment, stored XSS and CSRF in a local project.
5. **Audit** an Express project for leaked secrets, unsafe configuration and risky dependencies, using the OWASP Top 10:2025 as a checklist.

---

## 2. Prerequisite check

Learners must already be able to:

- Build an Express app with routers, middleware and an error-handling middleware.
- Write `async/await` TypeScript, including interfaces, union types and basic generics.
- Explain HTTP methods, status codes, headers and cookies at a basic level.
- Read simple SQL: `SELECT`, `INSERT`, `UPDATE` and `WHERE`.
- Use the browser dev tools Network and Console tabs, and `curl`.

**Where this fits:** the prior lessons taught learners how to make an API work. This one teaches them to make it work only for the right people.

---

## 3. Section breakdown

### Section 0: Project setup (10 minutes)

You will start with an API that is insecure on purpose, then attack and repair it over the session. Run it only on your own machine.

```bash
mkdir taskvault && cd taskvault
npm init -y
npm pkg set type=module
npm i express express-session argon2 jose openid-client helmet express-rate-limit zod better-sqlite3
npm i -D typescript tsx oauth2-mock-server @types/express @types/express-session @types/node @types/better-sqlite3
npm pkg set scripts.dev="tsx watch --env-file=.env src/server.ts" scripts.typecheck="tsc --noEmit" scripts.seed="tsx --env-file=.env src/seed.ts"
mkdir -p src/lib src/middleware src/routes src/security demo
```

`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "demo"]
}
```

`.gitignore`

```text
node_modules/
dist/
.env
*.db
*.db-*
```

`.env.example` is committed and holds names only. Copy it to `.env`, which is never committed, then fill in the two secrets.

```bash
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:3000
DATABASE_PATH=taskvault.db
# Generate each with: openssl rand -base64 32
SESSION_SECRET=
JWT_SECRET=
# Filled in during Section 6. Leave blank until then.
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
```

```bash
cp .env.example .env
openssl rand -base64 32   # run twice: once for SESSION_SECRET, once for JWT_SECRET
```

`src/config.ts` validates the environment at startup, so a missing secret stops the app immediately instead of causing a confusing failure later.

```ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_PATH: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  OIDC_ISSUER: z.preprocess((v) => v || undefined, z.url().optional()),
  OIDC_CLIENT_ID: z.preprocess((v) => v || undefined, z.string().optional()),
  OIDC_CLIENT_SECRET: z.preprocess((v) => v || undefined, z.string().optional()),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Print which variables failed, never their values.
  const names = parsed.error.issues.map((issue) => issue.path.join("."));
  console.error(`Invalid environment variables: ${names.join(", ")}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === "production";
```

`src/db.ts`

```ts
import Database from "better-sqlite3";
import { config } from "./config.js";

export const db = new Database(config.DATABASE_PATH);
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    oidc_issuer   TEXT,
    oidc_subject  TEXT,
    UNIQUE (oidc_issuer, oidc_subject)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id       INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    notes    TEXT NOT NULL DEFAULT '',
    done     INTEGER NOT NULL DEFAULT 0
  );
`);

export type Role = "member" | "admin";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string | null;
  role: Role;
  oidc_issuer: string | null;
  oidc_subject: string | null;
}

export interface TaskRow {
  id: number;
  owner_id: number;
  title: string;
  notes: string;
  done: number;
}

export function findUserById(id: number): UserRow | undefined {
  return db.prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?").get(id);
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?").get(email);
}
```

`src/express.d.ts` teaches TypeScript about `req.user` and our session fields. It looks ahead to fields you will use later.

```ts
import type { Role } from "./db.js";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  via: "session" | "jwt";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
    csrfToken?: string;
    oidc?: { state: string; nonce: string; codeVerifier: string };
  }
}
```

`src/lib/errors.ts`

```ts
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
```

`src/middleware/errors.ts`

```ts
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/errors.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Errors raised by body parsers carry a 4xx status (for example, malformed JSON).
  if (typeof err?.status === "number" && err.status < 500) {
    res.status(err.status).json({ error: "Bad request" });
    return;
  }
  console.error({ method: req.method, path: req.path, err });
  res.status(500).json({ error: "Internal server error" });
};
```

`src/middleware/auth.ts` (temporary and deliberately broken, repaired in Section 3)

```ts
import type { RequestHandler } from "express";
import { findUserById, type Role } from "../db.js";
import { HttpError } from "../lib/errors.js";

// DELIBERATELY BROKEN. Trusts a header the client controls.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const user = findUserById(Number(req.get("x-user-id")));
  if (!user) throw new HttpError(401, "Authentication required");
  req.user = { id: user.id, email: user.email, role: user.role, via: "session" };
  next();
};

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, "Authentication required");
    if (!allowed.includes(req.user.role)) throw new HttpError(403, "Forbidden");
    next();
  };
}
```

`src/routes/tasks.vulnerable.ts`

```ts
// DELIBERATELY INSECURE. Local classroom use only. You will replace this file.
import { Router } from "express";
import { db, type TaskRow } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

// Bug 1: injection. User input is pasted into the SQL text.
tasksRouter.get("/", (req, res) => {
  const search = String(req.query.search ?? "");
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE owner_id = ${req.user!.id} AND title LIKE '%${search}%'`)
    .all();
  res.json(rows);
});

// Bug 2: mass assignment. The client chooses which columns get written.
tasksRouter.post("/", (req, res) => {
  const row = { owner_id: req.user!.id, notes: "", ...req.body };
  const result = db
    .prepare("INSERT INTO tasks (owner_id, title, notes) VALUES (@owner_id, @title, @notes)")
    .run(row);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

// Bug 3: broken object-level authorization. Any logged-in user can read any task.
tasksRouter.get("/:id", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json(task);
});

// Bug 4: broken object-level authorization on a write.
tasksRouter.post("/:id/complete", (req, res) => {
  db.prepare("UPDATE tasks SET done = 1 WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// Bug 5: stored XSS. The title goes into HTML with no output encoding.
tasksRouter.get("/:id/preview", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as
    | TaskRow
    | undefined;
  if (!task) return res.status(404).send("Not found");
  res.type("html").send(`<!doctype html><h1>${task.title}</h1><p>${task.notes}</p>`);
});
```

`src/app.ts`

```ts
import express from "express";
import { errorHandler } from "./middleware/errors.js";
import { tasksRouter } from "./routes/tasks.vulnerable.js";

export const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/tasks", tasksRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);
```

`src/server.ts`

```ts
import { app } from "./app.js";
import { config } from "./config.js";

app.listen(config.PORT, () => {
  console.log(`TaskVault listening on ${config.APP_ORIGIN}`);
});
```

`src/seed.ts`

```ts
import { db } from "./db.js";

db.exec("DELETE FROM tasks; DELETE FROM users;");

const addUser = db.prepare("INSERT INTO users (id, email, role) VALUES (?, ?, ?)");
addUser.run(1, "alice@example.com", "member");
addUser.run(2, "bob@example.com", "member");
addUser.run(3, "admin@example.com", "admin");

const addTask = db.prepare("INSERT INTO tasks (id, owner_id, title, notes) VALUES (?, ?, ?, ?)");
addTask.run(1, 1, "Alice: renew passport", "Private: passport number is on file");
addTask.run(2, 1, "Alice: pay rent", "");
addTask.run(3, 2, "Bob: buy groceries", "");

console.log("Seeded users 1 (alice), 2 (bob), 3 (admin).");
```

```bash
npm run seed
npm run dev
curl -i http://localhost:3000/health
```

> **Version note: Express 5.** A rejected promise or a `throw` in an `async` handler now reaches your error middleware automatically, so this project needs no `try/catch` wrappers or `express-async-errors`. Also, `req.body` is `undefined` until a body parser runs, and `req.query` is a read-only getter. On Express 4, async errors must be passed to `next(err)` by hand.

> **Version note: TypeScript 7.** This is the native compiler. The `tsc` commands used here behave as usual, but check any compiler-API tooling your team relies on. tsx runs the code without type-checking, so run `npm run typecheck` as well.

---

### Section 1: Authentication versus authorisation (10 minutes)

#### Explanation

**Authentication (AuthN)** answers "who are you?" by checking evidence such as a password or a signed token. **Authorisation (AuthZ)** answers "are you allowed to do this?" by checking a policy against the identity you have established. Authentication comes first, and it must be repeated in some form on every request because HTTP is **stateless**, meaning that each request stands alone.

There are three levels of authorisation:

| Level    | Question                                    | TaskVault example                         |
| -------- | ------------------------------------------- | ----------------------------------------- |
| Function | May this kind of user call this route?      | Only an admin can call `GET /admin/users` |
| Object   | May this user touch this particular record? | Only Alice can read Alice's task          |
| Property | May this user read or write this field?     | Nobody can set their own `role`           |

The status codes follow the same split:

- **`401 Unauthorized`** means the server does not know who you are. Despite its name, it is about authentication.
- **`403 Forbidden`** means the server knows who you are, and the answer is no.
- **`404 Not Found`** is a deliberate alternative to `403` when even admitting that a record exists would leak information.

#### Why it matters

OWASP ranks **Broken Access Control** as A01:2025, the top web application risk. Authentication can work perfectly while authorisation is missing, and that is usually how these bugs reach production: every test user logs in successfully, and nobody tries to open another user's record.

#### Mental model

Think of an airport. The passport desk is authentication: it confirms who you are. The boarding gate is authorisation: it checks whether that person may board this flight. Your existing Express knowledge maps directly onto this, because each desk is a middleware in the chain, and any desk can end the request.

#### Code example

Our starter `requireAuth` from `src/middleware/auth.ts` trusts a header, which is exactly what an authentication check must not do:

```ts
const user = findUserById(Number(req.get("x-user-id")));
```

- `req.get("x-user-id")` is client-controlled input, so it proves nothing. Anyone can type any number.
- `requireAuth` answers with `401` when there is no identity. `requireRole` answers with `403` when the identity is known but lacks the role.
- `requireRole("admin")` is a function that returns middleware, the same pattern as `express.json({ limit })`.

Exploit it:

```bash
curl -i http://localhost:3000/tasks                         # 401: no identity
curl -H "x-user-id: 2" http://localhost:3000/tasks/1        # Bob reads Alice's task
curl -H "x-user-id: 1" http://localhost:3000/tasks/1        # "Bob" just claims to be Alice
```

#### Common beginner mistakes

| Mistake                                                                | Symptom                                                    | Fix                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Trusting a client-supplied identity (header, body field, hidden input) | Anyone can become anyone with a `curl` command             | Derive identity only from a verified session or token                       |
| Returning `401` when a logged-in user lacks permission                 | The front end sends users back to the login page in a loop | Return `403`, or `404` for objects they should not know about               |
| Hiding the admin button but leaving the route open                     | A direct request to the route still succeeds               | Enforce permissions on the server. UI checks are only a convenience         |
| Mounting a guard after the router it protects                          | The route responds without any auth check                  | Put middleware before routes: `app.use("/admin", requireAuth, adminRouter)` |

#### Try it

Add `src/routes/admin.routes.ts` below, import `adminRouter` in `src/app.ts`, and mount it with `app.use("/admin", adminRouter)` before the 404 handler. Call `/admin/users` with no header, with `x-user-id: 1`, and with `x-user-id: 3`. Predict each status code before you press Enter. You should see `401`, `403` and `200`.

```ts
import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

adminRouter.get("/users", (_req, res) => {
  res.json(db.prepare("SELECT id, email, role FROM users ORDER BY id").all());
});
```

---

### Section 2: Password hashing (15 minutes)

#### Explanation

**Hashing** is a one-way transformation, so the server can verify a password without being able to recover it. **Encryption** is two-way, so anyone with the key can reverse it, which is why encrypted passwords are the wrong tool.

General-purpose hashes such as SHA-256 are designed to be fast, which helps an attacker test billions of guesses. Password hashes are slow on purpose. Three terms matter here:

- A **salt** is a random value stored with each hash. Two users with the same password get different hashes, which defeats precomputed lookup tables.
- A **work factor** sets how expensive one guess is, and you can raise it over time.
- **Argon2id** is OWASP's first choice. It is **memory-hard**, meaning each guess needs a lot of RAM, which makes specialised cracking hardware less effective.

OWASP's minimum for Argon2id is 19 MiB of memory, 2 iterations and 1 degree of parallelism. Use `scrypt` if Argon2id is unavailable. Treat bcrypt as a legacy option: it has a 72-byte input limit for most implementations. Use PBKDF2 when FIPS-140 compliance requires it.

#### Why it matters

Assume your database will leak one day. Strong hashing determines whether that means changing some credentials or handing attackers your users' passwords, which many people reuse on other sites.

#### Mental model

A hash is like a smoothie. Making one from the ingredients is easy, and you can check a recipe by blending it again, but you cannot turn the smoothie back into fruit. The salt is a secret-free extra ingredient unique to each glass, and the work factor is how long the blender must run. Compare `crypto.createHash("sha256")`, which you may already know from Node: it is a blender that finishes instantly, which is what the attacker wants.

#### Code example

`src/security/password.ts`

```ts
import argon2 from "argon2";

// OWASP's minimum is m=19456, t=2, p=1. Benchmark on your own hardware and raise it if you can.
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

// A valid hash of a random value. Lets login spend the same time when the email is unknown.
const dummyHash = argon2.hash(crypto.randomUUID(), OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (hash === null) {
    await argon2.verify(await dummyHash, password);
    return false;
  }
  return argon2.verify(hash, password);
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTIONS);
}
```

- `type: argon2.argon2id` selects the recommended variant explicitly, rather than relying on a library default.
- No salt appears because the library generates a unique one per hash and stores it inside the output string.
- `dummyHash` supports the unknown-email path. Without it, an unknown email would return faster than a wrong password, and that timing difference tells an attacker which emails have accounts.
- `verifyPassword` always returns a `Promise<boolean>`, and it takes `null` for accounts that have no password, such as single sign-on accounts.
- `passwordNeedsRehash` lets you upgrade old hashes at the moment you have the plain password, which is at login.

The stored string describes itself, so old hashes keep verifying after you raise the settings:

```text
$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
```

Now update `src/seed.ts` so the demo users have real password hashes, then run `npm run seed`:

```ts
import { db } from "./db.js";
import { hashPassword } from "./security/password.js";

const DEMO_PASSWORD = "correct horse battery staple";
const hash = await hashPassword(DEMO_PASSWORD);

db.exec("DELETE FROM tasks; DELETE FROM users;");

const addUser = db.prepare(
  "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)",
);
addUser.run(1, "alice@example.com", hash, "member");
addUser.run(2, "bob@example.com", hash, "member");
addUser.run(3, "admin@example.com", hash, "admin");

const addTask = db.prepare("INSERT INTO tasks (id, owner_id, title, notes) VALUES (?, ?, ?, ?)");
addTask.run(1, 1, "Alice: renew passport", "Private: passport number is on file");
addTask.run(2, 1, "Alice: pay rent", "");
addTask.run(3, 2, "Bob: buy groceries", "");

console.log("Seeded users 1 (alice), 2 (bob), 3 (admin).");
```

**Password rules.** NIST SP 800-63B-4 requires a minimum of 15 characters for passwords used as a single factor, or 8 when used only as part of multi-factor authentication. It forbids composition rules such as "must include a symbol", forbids routine forced rotation, and requires checking new passwords against a blocklist of common or compromised values. TaskVault applies the 15-character minimum and a 128-character maximum. The maximum stops an attacker from sending enormous inputs to an expensive function. The blocklist is a stretch task in Section 6 of this document.

#### Common beginner mistakes

| Mistake                                                | Symptom                                                                                                              | Fix                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Forgetting `await` on `verifyPassword`                 | A `Promise` is always truthy, so any password can log in. TypeScript often reports that the condition is always true | Always `await`, and keep `strict` on                                     |
| Using SHA-256 or MD5                                   | Login works, and nothing looks wrong until the database leaks                                                        | Use Argon2id through a maintained library                                |
| Generating and storing your own salt column            | Extra code, and sometimes a shared salt by mistake                                                                   | Let the library manage it                                                |
| Using `===` to compare a new hash with the stored one  | Correct passwords always fail, because each hash has a fresh salt                                                    | Call `argon2.verify`                                                     |
| Logging `req.body` during login                        | Plain passwords appear in your logs                                                                                  | Never log credentials, and redact these fields in your logger            |
| Setting costs so high that login takes several seconds | Logins are slow, and attackers can exhaust the CPU                                                                   | Benchmark on real hardware, aim for under a second, and rate-limit login |

#### Try it

In a scratch file, hash the same password twice and print both results. Confirm that the strings differ and that `argon2.verify` accepts both. Then time one hash with `console.time`, change `memoryCost` to `65536`, and time it again.

---

### Section 3: Secure sessions (20 minutes)

#### Explanation

A **session** is login state kept on the server. After a successful login, the server stores `{ userId }` under a long random **session ID** and gives the browser that ID in a cookie. The browser sends the cookie with each request, and the server looks up the state. The ID must be unguessable, and it should be treated as equal to a password while it is valid.

Cookie attributes do the protective work:

| Attribute             | What it does                                                                                           | TaskVault        |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| `HttpOnly`            | Hides the cookie from JavaScript, limiting theft through XSS                                           | On               |
| `Secure`              | Sends the cookie over HTTPS only                                                                       | On in production |
| `SameSite`            | Controls whether the cookie is sent on cross-site requests                                             | `Lax`            |
| `Max-Age`             | Sets a lifetime, here refreshed on activity                                                            | 2 hours idle     |
| `__Host-` name prefix | Makes the browser require `Secure`, `Path=/` and no `Domain`, which blocks overwriting from subdomains | In production    |

**Session fixation** is an attack where the attacker gets a victim to use a session ID the attacker already knows, then waits for the victim to log in. If the ID stays the same at login, the attacker now shares an authenticated session. The defence is one line: issue a new ID at every login.

#### Why it matters

Sessions can be revoked instantly by deleting the server record, which makes them a strong default for your own browser front end. Most session bugs come from a wrong setting, rather than broken cryptography, so a short list of settings prevents most of them.

#### Mental model

A session is a cloakroom. You hand over your coat, which is your identity data, and receive a numbered ticket, which is the cookie. The ticket itself contains nothing useful, and the cloakroom can cancel it at any time. Compare a `Map<string, { userId: number }>` in your own Node code: that is essentially what the default store is.

#### Code example

`src/middleware/session.ts`

```ts
import session from "express-session";
import { config, isProduction } from "../config.js";

export const SESSION_COOKIE = isProduction ? "__Host-sid" : "sid";

export const sessionMiddleware = session({
  name: SESSION_COOKIE,
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 2, // two hours of inactivity
  },
});
```

- `secret` signs the cookie so a tampered ID is rejected. The ID itself is already random.
- `resave: false` and `saveUninitialized: false` avoid unnecessary writes, and stop the server from creating a session for every anonymous visitor.
- `rolling: true` extends the two-hour limit on activity. For sensitive apps, also store a login time and enforce an absolute limit.
- `secure: isProduction` exists because local development runs on plain HTTP.

> **Placeholder: production session store.** The default `MemoryStore` loses sessions on restart, does not work across multiple servers, and is documented as unsuitable for production. Use a real store such as `connect-redis`, covered in a later deployment lesson.

`src/lib/session.ts` wraps the callback APIs so they fit `async/await`.

```ts
import type { Request } from "express";

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
```

`src/routes/auth.routes.ts`

```ts
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db, findUserByEmail } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { destroySession, regenerateSession, saveSession } from "../lib/session.js";
import { requireAuth } from "../middleware/auth.js";
import { SESSION_COOKIE } from "../middleware/session.js";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "../security/password.js";

export const authRouter = Router();

const registerSchema = z.strictObject({
  email: z.email().toLowerCase(),
  password: z.string().min(15).max(128),
});

const loginSchema = z.strictObject({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(128),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

authRouter.post("/register", async (req, res) => {
  const { email, password } = registerSchema.parse(req.body);
  const passwordHash = await hashPassword(password);
  db.prepare("INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)").run(
    email,
    passwordHash,
  );

  // Same response, and no login, whether the email is new or taken. This hides which emails exist.
  // A real app would now email the address with a verification link.
  res.status(202).json({ message: "If that email can be registered, the account is ready." });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = findUserByEmail(email);

  const valid = await verifyPassword(user?.password_hash ?? null, password);
  if (!user || !valid) throw new HttpError(401, "Invalid email or password");

  if (user.password_hash && passwordNeedsRehash(user.password_hash)) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      await hashPassword(password),
      user.id,
    );
  }

  await regenerateSession(req); // new session ID, so a pre-login ID is now useless
  req.session.userId = user.id;
  await saveSession(req);
  res.json({ id: user.id, email: user.email, role: user.role });
});

authRouter.post("/logout", async (req, res) => {
  await destroySession(req);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});
```

- `z.strictObject` rejects unknown fields, so `{"role":"admin"}` at registration gets a `400`.
- `register` gives the same answer whether or not the email is taken, and it does not log the user in. Either difference would reveal which emails have accounts.
- `login` gives one error message for both failure cases, for the same reason.
- `regenerateSession` comes before setting `userId`. This is the session fixation defence.
- `saveSession` guarantees the store write finished before the response goes out.
- `loginLimiter` slows password guessing. `skipSuccessfulRequests` means normal logins do not use up the allowance.

Replace `src/middleware/auth.ts` so identity comes from the session:

```ts
import type { RequestHandler } from "express";
import { findUserById, type Role } from "../db.js";
import { HttpError } from "../lib/errors.js";

export const requireAuth: RequestHandler = (req, _res, next) => {
  const user = req.session.userId === undefined ? undefined : findUserById(req.session.userId);
  if (!user) throw new HttpError(401, "Authentication required");
  req.user = { id: user.id, email: user.email, role: user.role, via: "session" };
  next();
};

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, "Authentication required");
    if (!allowed.includes(req.user.role)) throw new HttpError(403, "Forbidden");
    next();
  };
}
```

Reading the user from the database on each request means a deleted user or changed role takes effect immediately.

Add these lines to `src/app.ts`, keeping the session middleware before any router that uses it:

```ts
import { sessionMiddleware } from "./middleware/session.js";
import { authRouter } from "./routes/auth.routes.js";

// After express.json():
app.use(sessionMiddleware);

// Before the tasks router:
app.use("/auth", authRouter);
```

Test it with a cookie jar:

```bash
curl -i -c jar.txt -X POST http://localhost:3000/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"alice@example.com","password":"correct horse battery staple"}'

curl -b jar.txt http://localhost:3000/auth/me
curl -H "x-user-id: 1" -i http://localhost:3000/auth/me   # now 401: the header means nothing
```

The login response includes a header like this one:

```text
Set-Cookie: sid=s%3A...; Path=/; Expires=...; HttpOnly; SameSite=Lax
```

> **Version note: express-rate-limit.** Version 8 uses `limit`, which replaced the older `max` option, and `standardHeaders: "draft-8"` selects the current header format. Its store is also per-process by default, so a multi-server deployment needs a shared store.

#### Common beginner mistakes

| Mistake                                                    | Symptom                                                                                                                              | Fix                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Mounting routers before the session middleware             | `TypeError: Cannot read properties of undefined (reading 'userId')`                                                                  | Register `sessionMiddleware` first                                                                 |
| `secure: true` on `http://`                                | Login returns `200`, yet the next request gets `401` because the cookie was never stored                                             | Tie `secure` to the environment                                                                    |
| Missing `trust proxy` behind a load balancer in production | Express thinks the connection is HTTP, so no `Set-Cookie` appears. The rate limiter also raises `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` | `app.set("trust proxy", 1)` for exactly one proxy. Avoid `true`, which lets clients spoof their IP |
| Skipping `regenerate` at login                             | Login works. The cookie value does not change, so session fixation is possible                                                       | Regenerate on login and on privilege changes                                                       |
| Logging out by only deleting the cookie                    | A copied cookie still works                                                                                                          | Call `req.session.destroy()`, then clear the cookie                                                |
| Telling users "email not found"                            | Attackers can list your users                                                                                                        | Return one generic message                                                                         |

#### Try it

Save the `sid` value from before and after a login, and confirm that they differ. Then copy the cookie jar with `cp jar.txt old.txt`, log out, and call `/auth/me` with `old.txt`. You should get `401`, which shows the server revoked the session and did not just ask the browser to forget it. Remember that once you add CSRF protection in Section 10, these `POST` calls will need a token.

---

### Section 4: JSON Web Tokens with jose (15 minutes)

#### Explanation

A **JSON Web Token (JWT)** is a compact, signed string with three Base64URL parts: `header.payload.signature`.

```json
{ "alg": "HS256" }
{ "sub": "1", "iss": "http://localhost:3000", "aud": "taskvault-api", "iat": 1793770077, "exp": 1793770977 }
```

The payload holds **claims**, which are statements about the token:

- `sub` is the subject, here the user ID.
- `iss` is the issuer, meaning who created the token.
- `aud` is the audience, meaning who the token is for.
- `exp` is the expiry time, and `iat` is the time of issue.

Most importantly, **signed does not mean encrypted**. Anyone can decode the payload. The signature only proves that the holder of the key created it and that nobody changed it. Never put secrets or personal data in a JWT.

A **bearer token** works for whoever holds it, sent as `Authorization: Bearer <token>`. Signing comes in two forms. **Symmetric** algorithms such as HS256 use one shared secret to sign and verify, which suits a single service. **Asymmetric** algorithms such as RS256 or ES256 sign with a private key and verify with a public key, which suits many independent verifiers.

|                               | Server-side session        | JWT access token                                 |
| ----------------------------- | -------------------------- | ------------------------------------------------ |
| Where state lives             | Server store               | Inside the token                                 |
| Instant revocation            | Yes, delete the record     | Not on its own. Needs short expiry or a denylist |
| Verification                  | Store lookup               | Signature check, no store needed                 |
| Sent by browser automatically | Yes, so CSRF applies       | No, if sent in the `Authorization` header        |
| Best fit                      | Your own browser front end | Mobile apps, CLIs, service-to-service calls      |

OWASP's JWT guidance is to prefer plain server-side sessions when you need reliable invalidation, because a denylist makes JWTs stateful and removes their main benefit.

#### Why it matters

JWTs appear everywhere: in OIDC, API gateways and third-party services. They are also frequently misused as a session replacement, which brings revocation and storage problems that sessions do not have.

#### Mental model

A session cookie is a cloakroom ticket that means nothing without the cloakroom's records. A JWT is a festival wristband: it carries the information with it, and any gate can check it without calling head office. You cannot easily take a wristband back, so make it expire soon.

#### Code example

`src/security/jwt.ts`

```ts
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const key = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = config.APP_ORIGIN;
const AUDIENCE = "taskvault-api";

export function signAccessToken(userId: number): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<number> {
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
    requiredClaims: ["sub", "exp"],
  });
  return Number(payload.sub);
}
```

- `new TextEncoder().encode(...)` produces the `Uint8Array` key that `jose` expects. The config requires at least 32 characters, and our generated secrets are random.
- `setExpirationTime("15m")` limits the damage if a token is stolen.
- `algorithms: ["HS256"]` hard-codes the accepted algorithm. Never let the token's own header decide how it gets verified.
- `issuer` and `audience` stop a token issued for a different purpose from being accepted here.
- `requiredClaims` rejects tokens that simply leave those claims out.

Replace `src/middleware/auth.ts` with the final version, which supports both credentials:

```ts
import type { RequestHandler } from "express";
import { findUserById, type Role } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { verifyAccessToken } from "../security/jwt.js";

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.get("authorization");

  if (header !== undefined) {
    // A request that presents a token lives or dies by that token. Never fall back to the cookie.
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new HttpError(401, "Authentication required");
    }
    const userId = await verifyAccessToken(token).catch(() => undefined);
    const user = userId === undefined ? undefined : findUserById(userId);
    if (!user) throw new HttpError(401, "Authentication required");
    req.user = { id: user.id, email: user.email, role: user.role, via: "jwt" };
    return next();
  }

  const user = req.session.userId === undefined ? undefined : findUserById(req.session.userId);
  if (!user) throw new HttpError(401, "Authentication required");
  req.user = { id: user.id, email: user.email, role: user.role, via: "session" };
  next();
};

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, "Authentication required");
    if (!allowed.includes(req.user.role)) throw new HttpError(403, "Forbidden");
    next();
  };
}
```

- If an `Authorization` header is present, only that token counts. A bad token gets `401` even when a valid cookie is present. Section 10 relies on this rule.
- `.catch(() => undefined)` turns every verification failure into the same `401`. Clients should not learn whether the signature or the expiry was the problem.
- Looking up the user means a deleted account loses access straight away and `role` always reflects the database. This trades away some statelessness for accuracy, and it is why we did not put `role` in the token.

Add the token route to `src/routes/auth.routes.ts`, and import `signAccessToken` from `"../security/jwt.js"`:

```ts
authRouter.post("/token", requireAuth, async (req, res) => {
  // Only a session can mint a token, otherwise a stolen token could renew itself forever.
  if (req.user!.via !== "session") throw new HttpError(403, "Forbidden");
  res.json({ accessToken: await signAccessToken(req.user!.id), expiresIn: 900 });
});
```

```bash
TOKEN=$(curl -s -b jar.txt -X POST http://localhost:3000/auth/token | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -H "authorization: Bearer $TOKEN" http://localhost:3000/auth/me
```

**Verifying tokens from someone else.** When another service issues tokens, verify them against its published public keys. `createRemoteJWKSet` downloads and caches them from a **JWKS** (JSON Web Key Set) endpoint:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://issuer.example.com/.well-known/jwks.json"));

const { payload } = await jwtVerify(token, jwks, {
  issuer: "https://issuer.example.com",
  audience: "taskvault-api",
  algorithms: ["RS256"],
});
```

**Refresh tokens.** An access token should be short-lived, but nobody wants to log in every 15 minutes. A **refresh token** is a long-lived credential used only to get new access tokens. It must be stored server-side so it can be revoked, and it should be **rotated**, meaning replaced on each use, so that reuse of an old one signals theft. TaskVault avoids this complexity by using the session to mint tokens.

**Where should a browser keep a JWT?** `localStorage` can be read by any script, so a single XSS bug steals the token. An `HttpOnly` cookie blocks reading but brings CSRF back. For your own front end, this trade-off is a good reason to use a session instead.

> **Version note: jose.** Version 6 is ESM-first and uses Web Crypto, so it runs in Node, browsers and edge runtimes. `jsonwebtoken` is also common in existing Node projects. If you meet it, always pass `algorithms` to `jwt.verify`.

#### Common beginner mistakes

| Mistake                                      | Symptom                                                                    | Fix                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Using `decodeJwt` to authenticate            | Forged tokens are accepted, since decoding checks nothing                  | Use `jwtVerify`                                         |
| Accepting whatever `alg` the token names     | Attacks such as `alg: none`, or confusing public keys with HMAC secrets    | Hard-code `algorithms`                                  |
| Omitting `exp` or using a very long lifetime | A stolen token works for months                                            | Use minutes for access tokens, and require `exp`        |
| Weak secret such as `"secret"`               | Tokens can be cracked offline and then forged                              | Use at least 32 random bytes from a secure generator    |
| Storing a role in a long-lived token         | A demoted admin keeps admin access until expiry                            | Use short lifetimes, or read the role from the database |
| Falling back to the cookie after a bad token | A forged header still acts as the logged-in user, and it skips CSRF checks | A presented token decides the result on its own         |

#### Try it

Paste a token's middle section into this command and read the claims without any key. Then change one character of the token and call `/auth/me` to confirm you get `401`.

```bash
echo "$TOKEN" | cut -d. -f2 | node -pe 'Buffer.from(require("fs").readFileSync(0,"utf8").trim(),"base64url").toString()'
```

---

### Section 5: OAuth 2.0 and OpenID Connect concepts (10 minutes)

#### Explanation

**OAuth 2.0** is a framework for **delegated authorisation**. It lets a user allow an app to access something on their behalf without giving the app their password. **OpenID Connect (OIDC)** is an identity layer on top of OAuth 2.0 that adds a standard way to learn who the user is. In short: OAuth answers "what can this app access?", and OIDC adds "who just signed in?".

The roles are:

- **Resource owner:** the user.
- **Client:** your app, TaskVault. A **confidential client** can keep a secret, because it runs on a server. A **public client**, such as a single-page or mobile app, cannot.
- **Authorization server:** the system that logs the user in and issues tokens. In OIDC it is called the **OpenID Provider (OP)**. Google and Microsoft Entra ID are examples.
- **Resource server:** the API that accepts access tokens.

There are three token types:

| Token               | Audience                 | Purpose                                                                          |
| ------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| **ID token** (OIDC) | Your client              | A signed JWT saying who logged in. Never send it to APIs as an access credential |
| **Access token**    | The resource server      | Permission to call an API. Treat it as opaque in your client                     |
| **Refresh token**   | The authorization server | Obtains new access tokens                                                        |

The current standard flow is the **Authorization Code flow with PKCE**:

1. The user clicks "Sign in". Your server creates `state`, `nonce` and a PKCE `code_verifier`, then stores them in the session.
2. Your server redirects the browser to the provider, with a `code_challenge` derived from the verifier.
3. The user logs in at the provider and approves access. Your app never sees the password.
4. The provider redirects back to your exact registered **redirect URI** with a short-lived `code` and the `state`.
5. Your server checks `state`, then exchanges the `code` plus the original `code_verifier` for tokens over a direct server-to-server connection.
6. Your server validates the ID token, including its signature, issuer, audience, expiry and `nonce`.
7. Your server creates its own session. From here on, it works like Section 3.

Each random value stops a different attack:

| Value                                  | Stops                                                                     | How                                                              |
| -------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `state`                                | Login CSRF, where an attacker logs the victim into the attacker's account | The callback must return the value this browser's session stored |
| `nonce`                                | Replay of an old ID token                                                 | The value inside the ID token must match the session             |
| **PKCE** (Proof Key for Code Exchange) | Theft or injection of the authorization code                              | Only the holder of the verifier can redeem the code              |

RFC 9700, the OAuth 2.0 security best current practice, says the older Implicit grant should not be used and the password grant must not be used. It also calls for exact redirect URI matching. OAuth 2.1, still a draft at the time of writing, consolidates this guidance.

#### Why it matters

Single sign-on removes password storage from your app, and business customers often require it. These flows are easy to get subtly wrong, so you should understand the concepts and leave the protocol details to a certified library.

#### Mental model

Think of a hotel key card. You prove your identity at reception, which is the provider, and receive a card that opens only certain doors for a limited time, which is the access token. The room door does not need your passport. The ID token is more like a signed note from reception to the hotel restaurant saying "this guest is Alice". It is meant for the restaurant, your app, and has no use as a door key.

#### Code example

The concepts become concrete in a single URL. This is the kind of redirect your server produces in step 2:

```text
http://localhost:9000/authorize
  ?client_id=taskvault
  &redirect_uri=http://localhost:3000/auth/oidc/callback
  &response_type=code
  &scope=openid email
  &state=<random>
  &nonce=<random>
  &code_challenge=<SHA-256 of the verifier>
  &code_challenge_method=S256
```

- `response_type=code` selects the authorization code flow.
- `scope=openid` is what turns an OAuth request into an OIDC request.
- `S256` is the secure PKCE method. RFC 9700 identifies it as the method that resists an attacker who can read the authorization request.

#### Common beginner mistakes

| Mistake                                          | Symptom                                                                     | Fix                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Treating an access token as proof of login       | An app can accept a token that was issued for a different app               | Use a validated ID token for login                                                                                   |
| Using `email` as the account key                 | An email reassignment or a matching address can take over an account        | Identify users by the `(iss, sub)` pair                                                                              |
| Using GitHub OAuth and expecting an ID token     | No `id_token` is returned, because GitHub's user login is plain OAuth       | Use an OIDC provider, or use a provider-specific library and API                                                     |
| A wildcard or loose redirect URI                 | Provider error `redirect_uri_mismatch`, or worse, codes sent to an attacker | Register exact URIs for each environment                                                                             |
| Using `localStorage` for tokens in a browser app | Tokens can be stolen through XSS                                            | Handle the flow on the server, or use a **backend-for-frontend**, a server that holds tokens for the single-page app |

#### Try it

Start the local provider with `npx oauth2-mock-server -p 9000`, then open `http://localhost:9000/.well-known/openid-configuration`. Find `authorization_endpoint`, `token_endpoint` and `jwks_uri`. This **discovery document** is how a library configures itself from just the issuer URL. Keep the provider running for the next section.

---

### Section 6: Implementing OIDC login with openid-client (15 minutes)

#### Explanation

`openid-client` is a certified OIDC implementation. It handles discovery, PKCE, the code exchange and ID token validation. Your job is limited to four things: keep the temporary values in the session, call the library correctly, map the verified identity to a local user, and start a local session.

#### Why it matters

Writing this protocol by hand means re-implementing signature validation, key rotation and claim checks, where one missed check can become an authentication bypass. In this area, "library-based" is the professional standard.

#### Mental model

The route pair resembles a `fetch` request split across two HTTP requests. `/login` starts it and saves its context in the session, much like a closure capturing variables. `/callback` resumes with that saved context, once the browser returns from the provider.

#### Code example

Add these values to `.env`. The mock provider accepts any client and logs in a fake user called `johndoe` with no password prompt, so it is for development only.

```bash
OIDC_ISSUER=http://localhost:9000
OIDC_CLIENT_ID=taskvault
OIDC_CLIENT_SECRET=dev-only-secret
```

`src/routes/oidc.routes.ts`

```ts
import { Router } from "express";
import * as oidc from "openid-client";
import { config, isProduction } from "../config.js";
import { db, findUserByEmail, type UserRow } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { regenerateSession, saveSession } from "../lib/session.js";

export const oidcRouter = Router();

const REDIRECT_URI = `${config.APP_ORIGIN}/auth/oidc/callback`;

let discovered: Promise<oidc.Configuration> | undefined;

function getProvider(): Promise<oidc.Configuration> {
  if (!config.OIDC_ISSUER || !config.OIDC_CLIENT_ID || !config.OIDC_CLIENT_SECRET) {
    throw new HttpError(503, "Single sign-on is not configured");
  }
  discovered ??= oidc
    .discovery(
      new URL(config.OIDC_ISSUER),
      config.OIDC_CLIENT_ID,
      config.OIDC_CLIENT_SECRET,
      undefined,
      // The local mock provider runs on http. Never allow this in production.
      isProduction ? undefined : { execute: [oidc.allowInsecureRequests] },
    )
    .catch((err: unknown) => {
      discovered = undefined; // do not cache a failure
      throw err;
    });
  return discovered;
}

oidcRouter.get("/login", async (req, res) => {
  const provider = await getProvider();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  req.session.oidc = { state, nonce, codeVerifier };
  await saveSession(req);

  const authorizationUrl = oidc.buildAuthorizationUrl(provider, {
    redirect_uri: REDIRECT_URI,
    scope: "openid email",
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
  });
  res.redirect(authorizationUrl.href);
});

oidcRouter.get("/callback", async (req, res) => {
  const provider = await getProvider();
  const pending = req.session.oidc;
  if (!pending) throw new HttpError(400, "Login session expired. Please try again.");
  delete req.session.oidc; // one use only

  const tokens = await oidc
    .authorizationCodeGrant(provider, new URL(req.originalUrl, config.APP_ORIGIN), {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    })
    .catch((err: unknown) => {
      console.error("OIDC callback failed", err);
      throw new HttpError(401, "Sign-in failed");
    });

  const claims = tokens.claims();
  if (!claims) throw new HttpError(401, "Sign-in failed");

  const user = findOrCreateOidcUser(claims.iss, claims.sub, claims.email);

  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);
  res.redirect("/auth/me");
});

// Identity is the (issuer, subject) pair. Email can change and can be reassigned.
function findOrCreateOidcUser(issuer: string, subject: string, email: unknown): UserRow {
  const existing = db
    .prepare<[string, string], UserRow>(
      "SELECT * FROM users WHERE oidc_issuer = ? AND oidc_subject = ?",
    )
    .get(issuer, subject);
  if (existing) return existing;

  // Never merge into an existing account just because the email matches.
  const claimed = typeof email === "string" ? email.toLowerCase() : undefined;
  const contactEmail =
    claimed && !findUserByEmail(claimed) ? claimed : `${subject}@oidc.invalid`;
  return db
    .prepare<[string, string, string], UserRow>(
      `INSERT INTO users (email, oidc_issuer, oidc_subject) VALUES (?, ?, ?) RETURNING *`,
    )
    .get(contactEmail, issuer, subject)!;
}
```

Mount it in `src/app.ts` before `/auth`, because `/auth/oidc` is the more specific path:

```ts
import { oidcRouter } from "./routes/oidc.routes.js";

app.use("/auth/oidc", oidcRouter);
```

- `discovered ??=` runs discovery once and shares the result, and the `.catch` clears it so a brief provider outage is not remembered forever.
- `allowInsecureRequests` is needed only because the mock uses HTTP. Without it, the library refuses non-HTTPS providers, which is the behaviour you want in production.
- `/login` saves `state`, `nonce` and `codeVerifier` before redirecting. Only the derived `code_challenge` leaves the server.
- `delete req.session.oidc` makes the values single-use, even if the exchange fails.
- `authorizationCodeGrant` checks `state`, redeems the code and validates the ID token and `nonce`. A failure throws, and we log the details but show the user a generic message.
- `new URL(req.originalUrl, config.APP_ORIGIN)` uses our configured origin, and avoids trusting the attacker-influenced `Host` header.
- `findOrCreateOidcUser` looks users up by `(iss, sub)`, and it never merges into an account with a matching email. If you later add account linking, require the user to prove control of both accounts.
- `regenerateSession` runs here as well, because this is a login.

Try the whole flow in your browser by opening `http://localhost:3000/auth/oidc/login`. You should land on `/auth/me` showing a new user with a placeholder email ending in `@oidc.invalid`, because the mock sends no `email` claim.

**Using a real provider.** Register the app with a provider such as Google, add your exact redirect URI, and set the issuer (`https://accounts.google.com` for Google), client ID and client secret in your environment. Your route code stays the same. This is the practical benefit of discovery.

> **Version note: openid-client.** Version 6 is a complete rewrite with a functional API (`discovery`, `buildAuthorizationUrl`, `authorizationCodeGrant`). Tutorials showing `Issuer.discover()` and `new client.Client()` are for version 5 and earlier, and they will not compile here.

#### Common beginner mistakes

| Mistake                                                                   | Symptom                                                                                                                                                                                                                  | Fix                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `SameSite: "strict"` on the session cookie                                | With a real provider, the callback fails with "Login session expired", because the browser withholds the cookie on the cross-site return. The local mock does not show this, as `localhost:9000` counts as the same site | Use `Lax`                                                           |
| Redirect URI differs from the registered one by a character               | Provider error such as `redirect_uri_mismatch`                                                                                                                                                                           | Match the scheme, host, port and path exactly                       |
| Different hosts for app and callback, such as `127.0.0.1` and `localhost` | Callback fails with "Login session expired" because the cookie belongs to the other host                                                                                                                                 | Use one origin consistently                                         |
| Not saving the session before redirecting                                 | Intermittent failures where `state` is missing                                                                                                                                                                           | `await saveSession(req)` first                                      |
| Copying a redirect target from the query string                           | An **open redirect**, which attackers use for phishing                                                                                                                                                                   | Allow only relative paths from an allowlist                         |
| Storing provider tokens you do not need                                   | More sensitive data to protect                                                                                                                                                                                           | Keep only the identity unless you actually call the provider's APIs |

#### Try it

Start a login with `curl -si -c o.txt http://localhost:3000/auth/oidc/login` and copy the `Location` URL. Request it with `curl -si "<url>"` to get the callback URL. Edit its `state` value and request it using `curl -si -b o.txt "<edited url>"`. You should get `401`, and the server log should show `unexpected "state" response parameter value`.

**Stretch:** add a password blocklist check at registration, using a list of common passwords or a k-anonymity lookup against a breach database. This meets the NIST requirement from Section 2.

---

### Section 7: The OWASP Top 10, ownership checks and mass assignment (20 minutes)

#### Explanation

The **OWASP Top 10** is an awareness list of the most critical web application risk categories. It is a starting point and a shared vocabulary, rather than a complete checklist. This table maps the 2025 edition to this project:

| ID  | Category                                  | Where you meet it                                |
| --- | ----------------------------------------- | ------------------------------------------------ |
| A01 | Broken Access Control (now includes SSRF) | Sections 1 and 7                                 |
| A02 | Security Misconfiguration                 | Sections 3 and 9                                 |
| A03 | Software Supply Chain Failures            | Section 11                                       |
| A04 | Cryptographic Failures                    | Sections 2 and 4                                 |
| A05 | Injection (includes XSS)                  | Sections 8 and 9                                 |
| A06 | Insecure Design                           | Throughout, for example token lifetime decisions |
| A07 | Authentication Failures                   | Sections 2, 3 and 6                              |
| A08 | Software or Data Integrity Failures       | Sections 4 and 11                                |
| A09 | Security Logging and Alerting Failures    | Section 11                                       |
| A10 | Mishandling of Exceptional Conditions     | The error handler and "fail closed" checks       |

The first entry's most common API form is **Insecure Direct Object Reference (IDOR)**, also called **Broken Object Level Authorization (BOLA)**: the user changes an ID in a request and gets someone else's data. **Mass assignment** is its property-level relative, where the server copies client-supplied fields straight into a record, allowing the client to set fields it should never control.

#### Why it matters

These bugs need no special tools, only an edited number in a URL, and automated scanners struggle to find them because the scanner cannot know who should own what. Your code is the only defence.

#### Mental model

Knowing that someone is a hotel guest does not mean they can open every room. Think of `SELECT * FROM tasks WHERE id = ?` as a master key. Adding `AND owner_id = ?` turns it into a key that only opens that guest's room. Compare `array.find(t => t.id === id)` with `array.find(t => t.id === id && t.ownerId === me)`: the second cannot return another person's task, whichever ID it receives.

#### Code example

First, exploit the current code. Log in as Bob and act on Alice's task:

```bash
curl -s -c bob.txt -X POST http://localhost:3000/auth/login -H "content-type: application/json" \
  -d '{"email":"bob@example.com","password":"correct horse battery staple"}'

curl -b bob.txt http://localhost:3000/tasks/1                # IDOR read
curl -b bob.txt -X POST http://localhost:3000/tasks/1/complete -i   # IDOR write

# Mass assignment: Bob plants a task on Alice's account
curl -b bob.txt -H "content-type: application/json" http://localhost:3000/tasks \
  -d '{"title":"Planted by Bob","owner_id":1}'
```

Now start the fix. Copy `tasks.vulnerable.ts` to `src/routes/tasks.routes.ts`, change the import in `app.ts` to the new file, and work through the changes. The complete final file is in Appendix A.

Put every single-task lookup through one function in `src/routes/tasks.routes.ts`:

```ts
// Every read or write of a single task goes through this one function.
function getTaskForRequest(req: Request): TaskRow {
  const taskId = idSchema.parse(req.params.id);
  const user = req.user!;
  const task =
    user.role === "admin"
      ? db.prepare<[number], TaskRow>("SELECT * FROM tasks WHERE id = ?").get(taskId)
      : db
          .prepare<[number, number], TaskRow>("SELECT * FROM tasks WHERE id = ? AND owner_id = ?")
          .get(taskId, user.id);
  if (!task) throw new HttpError(404, "Not found");
  return task;
}
```

- `idSchema.parse` rejects non-numeric IDs with `400` before any query runs.
- `WHERE id = ? AND owner_id = ?` puts the ownership rule in the query itself, so it cannot be forgotten after the fact.
- Not found and not yours produce the same `404`, which stops attackers from probing which IDs exist.
- Keeping the rule in one place means there is one function to review and test. The admin branch is an explicit decision that the code states openly.

Every route that works on one task uses it, including writes:

```ts
tasksRouter.post("/:id/complete", (req, res) => {
  const task = getTaskForRequest(req);
  db.prepare("UPDATE tasks SET done = 1 WHERE id = ?").run(task.id);
  res.status(204).end();
});

tasksRouter.delete("/:id", (req, res) => {
  const task = getTaskForRequest(req);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  res.status(204).end();
});
```

Stop mass assignment with strict schemas that list exactly what a client may send:

```ts
const createSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).default(""),
});

const updateSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(5000).optional(),
    done: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0);
```

```ts
tasksRouter.post("/", (req, res) => {
  const { title, notes } = createSchema.parse(req.body);
  const result = db
    .prepare("INSERT INTO tasks (owner_id, title, notes) VALUES (?, ?, ?)")
    .run(req.user!.id, title, notes);
  res.status(201).json({ id: Number(result.lastInsertRowid), title, notes, done: false });
});
```

- `z.strictObject` rejects unknown keys such as `owner_id` with `400`. Silently stripping them is also safe, but rejecting exposes client bugs and probing.
- The route takes `owner_id` from `req.user`, never from the body.
- The `INSERT` names its columns and values one by one. Avoid spreading `req.body` into a query or an ORM's update call.

#### Common beginner mistakes

| Mistake                                                    | Symptom                                                                           | Fix                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Checking ownership on `GET` only                           | Other users can still `PATCH` or `DELETE` your records                            | Use the shared lookup in every route, and test each method               |
| Passing `req.body` directly to an ORM update               | A user sends `{"role":"admin"}` and becomes an admin                              | Validate with an allowlist schema                                        |
| Using UUIDs instead of a check                             | IDs are harder to guess but leak through logs and links, and then work for anyone | Use UUIDs if you like, and always check ownership too                    |
| Checking ownership in the front end                        | `curl` bypasses it immediately                                                    | Enforce it on the server                                                 |
| Testing only with one account                              | All tests pass while IDOR exists                                                  | Keep a standing test where user B attempts every action on user A's data |
| Fetching the record, then forgetting to compare `owner_id` | No error, and the data leaks                                                      | Prefer query scoping, which fails closed with no row returned            |

#### Try it

Repeat the three exploit commands. You should now get `404`, `404` and `400`. Then log in as `admin@example.com` and confirm you can read task 1, and write down why that was a policy decision rather than a bug.

---

### Section 8: Injection (15 minutes)

#### Explanation

**Injection** occurs when untrusted input is combined with an instruction language, so the interpreter treats data as commands. SQL is the classic case, and the same pattern affects shell commands, NoSQL operators and template engines.

A **parameterised query**, also called a prepared statement, sends the query structure and the values separately. The database has already finished parsing the structure by the time it sees the values, so a value can never become SQL. This is the primary defence. Input validation is valuable as an additional layer, but it cannot replace parameters.

#### Why it matters

One injectable query can expose your whole database, even when the feature looks harmless, such as a search box. OWASP ranks Injection as A05:2025.

#### Mental model

Concatenating SQL is like building an HTML string with `innerHTML` from user input, where the input can change the structure of what you are building. Parameters are like `textContent`: the input stays as text, whatever characters it contains.

#### Code example

Exploit the vulnerable search route as Bob. The first payload removes the owner filter, and the second reads a different table entirely:

```bash
curl -s -G -b bob.txt http://localhost:3000/tasks --data-urlencode "search=' OR 1=1 --"

curl -s -G -b bob.txt http://localhost:3000/tasks \
  --data-urlencode "search=zzz' UNION SELECT id, id, email, password_hash, 0 FROM users --"
```

The second response returns password hashes in the `notes` field. Here is the SQL the server built for the first payload, where `--` comments out the rest:

```sql
SELECT * FROM tasks WHERE owner_id = 2 AND title LIKE '%' OR 1=1 --%'
```

The fix, in `src/routes/tasks.routes.ts`:

```ts
const listSchema = z.object({
  search: z.string().max(100).default(""),
  sort: z.enum(["id", "title"]).default("id"),
});
```

```ts
// Escape the LIKE wildcards so "%" and "_" are searched for literally.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

const SORT_COLUMNS = { id: "id", title: "title COLLATE NOCASE" } as const;

tasksRouter.get("/", (req, res) => {
  const { search, sort } = listSchema.parse(req.query);
  const rows = db
    .prepare<[number, string], TaskRow>(
      `SELECT * FROM tasks
       WHERE owner_id = ? AND title LIKE ? ESCAPE '\\'
       ORDER BY ${SORT_COLUMNS[sort]}`,
    )
    .all(req.user!.id, likePattern(search));
  res.json(rows);
});
```

- The `?` placeholders keep `req.user!.id` and the search term out of the SQL text.
- `listSchema` requires a single string. In Express 5, a repeated parameter (`?search=a&search=b`) produces an array, and this rejects it.
- `likePattern` is about correct behaviour rather than injection: without it, searching for `%` matches everything.
- **Placeholders only work for values.** Column names and `ORDER BY` directions cannot be parameters. Here `z.enum` restricts the input and `SORT_COLUMNS` maps it to SQL we wrote ourselves, so user text never reaches the query. Use this allowlist pattern for any dynamic identifier.

**Other forms of the same bug.**

*Command injection* happens when input reaches a shell. Avoid `exec`, which runs a shell, and pass arguments as an array:

```ts
import { execFile } from "node:child_process";

// Unsafe: exec(`convert ${filename} out.png`) lets filename contain "; rm -rf ~"
execFile("convert", [filename, "out.png"], (err) => {
  if (err) console.error("Conversion failed");
});
```

*NoSQL operator injection* happens when a query takes parsed JSON directly. With `{"password":{"$ne":null}}`, a query such as `User.findOne({ email, password: req.body.password })` can match without knowing the password. Validating that the value is a string, as our schemas do, blocks it.

**ORMs help, but they are not a guarantee.** Tools such as Prisma and Drizzle parameterise normal queries, yet their raw-SQL escape hatches can reintroduce the bug.

#### Common beginner mistakes

| Mistake                                        | Symptom                                                                                                                          | Fix                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Using a template literal inside `prepare()`    | It works in testing, and a quote in the input causes `SqliteError`                                                               | Always use `?` placeholders. A surprise `SqliteError` from user input is a red flag |
| `ORDER BY ?` with a column name                | No error, but the results do not sort, because the value is a constant                                                           | Use an allowlist mapped to fixed SQL                                                |
| Escaping quotes by hand                        | Passes basic tests and eventually misses an edge case                                                                            | Use parameters                                                                      |
| Believing a driver protects you                | `better-sqlite3` rejects `; DROP TABLE` with "The supplied SQL string contains more than one statement", yet `UNION` still works | Multi-statement limits do not prevent injection                                     |
| Returning database errors to clients           | Attackers learn your table and column names                                                                                      | Log details on the server, and send a generic message                               |
| Giving the app database user full admin rights | A single injection can drop tables                                                                                               | Apply **least privilege**: grant only the access the app needs                      |

#### Try it

Run both exploit commands again. Each should return `[]`, because the payload is now just an unusual search term. Then request `/tasks?sort=password_hash` and confirm you get `400`.

---

### Section 9: Cross-site scripting (10 minutes)

#### Explanation

**Cross-site scripting (XSS)** happens when attacker-controlled content runs as JavaScript in another user's browser, on your origin. The browser cannot tell it apart from your own code, so it gets the same privileges: it can read the page and send requests as the victim.

There are three types:

- **Stored:** the payload is saved on the server, such as in a task title, and runs for everyone who views it.
- **Reflected:** the payload comes from the current request, such as a search term echoed in a page.
- **DOM-based:** front-end code writes untrusted data into the page, such as `element.innerHTML = location.hash`.

Defences come in layers:

1. **Contextual output encoding** is the main defence. It converts data so that it displays as text in the place it is being inserted.
2. **Content Security Policy (CSP)** is a response header that limits which scripts may run. It reduces the damage if encoding is missed somewhere.
3. **`HttpOnly` cookies** stop scripts from reading the session ID, but XSS can still make requests as the user.

#### Why it matters

XSS defeats CSRF protections and can turn one bad field into control of a victim's account. As front-end developers, your learners already use the safe path: React escapes values by default, and `dangerouslySetInnerHTML` is the opt-out. A server that builds HTML strings has no such protection unless you add it.

#### Mental model

This is the `innerHTML` versus `textContent` distinction you know from the DOM. A template literal in `res.send` is `innerHTML`. `escapeHtml` gives it the behaviour of `textContent`.

#### Code example

Exploit it. In a browser, open `http://localhost:3000/health`, then run this in the Console to log in as Alice and create the payload:

```js
await fetch("/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "alice@example.com", password: "correct horse battery staple" }),
});
const res = await fetch("/tasks", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "<img src=x onerror=alert(document.domain)>" }),
});
const { id } = await res.json();
location.href = `/tasks/${id}/preview`;
```

An alert box appears. The title was treated as HTML, and an attacker's payload could just as easily call your API as the logged-in user.

Fix it with `src/lib/html.ts`:

```ts
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Safe for HTML text and quoted attribute values. Not for URLs, scripts or CSS.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char]!);
}
```

```ts
tasksRouter.get("/:id/preview", (req, res) => {
  const task = getTaskForRequest(req);
  res
    .type("html")
    .send(`<!doctype html><h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(task.notes)}</p>`);
});
```

Then add the second layer in `src/app.ts`, as the first middleware:

```ts
import helmet from "helmet";

app.use(helmet());
```

- `escapeHtml` handles the HTML text and quoted-attribute contexts, and `&` must be included so existing entities are not misread.
- `helmet()` sets a default CSP, including `script-src 'self'` and `script-src-attr 'none'`, which blocks inline scripts and `onerror`-style handlers. It also sets `X-Content-Type-Options: nosniff` and other useful headers.
- `res.json` is already safe here because its `application/json` response, combined with `nosniff`, is not rendered as HTML.

**Encoding depends on context.** HTML escaping does not make a value safe everywhere:

| Where the value goes          | What to do                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| HTML text or quoted attribute | HTML-encode it, or use a template engine that does so automatically                                                  |
| `href` or `src` attribute     | Parse with `new URL` and allow only `http:` and `https:`, because `javascript:` URLs contain no characters to escape |
| Inside `<script>`             | Avoid it. Put the data in a JSON response, or in an encoded `data-` attribute                                        |
| Rich user HTML                | Sanitise with an allowlist library such as DOMPurify, then keep the CSP                                              |

> **Version note: helmet.** Version 8's defaults include the policy above, plus `upgrade-insecure-requests` and HSTS. Check the actual response headers after an upgrade, and expect to customise the CSP if you load third-party scripts.

#### Common beginner mistakes

| Mistake                                                      | Symptom                                                            | Fix                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| "Cleaning" input by stripping `<script>`                     | `<img onerror=...>` still works                                    | Encode on output, for the context in which it appears |
| Encoding when saving to the database                         | `&lt;` appears in JSON and on screen, sometimes double-encoded     | Store the raw value, and encode at output             |
| Relying only on CSP                                          | One `unsafe-inline` added later removes the protection             | Treat CSP as a backup, and keep encoding              |
| Using `dangerouslySetInnerHTML` or `innerHTML` with API data | The same attack, now in the front end                              | Sanitise first, or render as text                     |
| Assuming `HttpOnly` stops XSS                                | The cookie is hidden, yet the script can still `fetch` as the user | Fix the XSS itself                                    |

#### Try it

Reload the preview. The payload now displays as plain text, and "View Source" shows `&lt;img`. Next, temporarily remove `escapeHtml` from the title and reload: the image fails, but no alert appears, and the Console reports a CSP violation. That is defence in depth working. Put `escapeHtml` back.

---

### Section 10: Cross-site request forgery (15 minutes)

#### Explanation

**Cross-site request forgery (CSRF)** tricks a logged-in user's browser into sending a request they did not intend. It works because browsers attach cookies automatically. The attacker cannot read the response, but for a state-changing action, the damage is already done.

The terminology matters here. An **origin** is the scheme, host and port. A **site** is broadly the scheme and registrable domain, ignoring ports and subdomains. So `localhost:4000` and `localhost:3000` are different origins but the same site, while `127.0.0.1` and `localhost` are different sites. `SameSite` works on sites, so it cannot help against an attack from a sibling subdomain.

The main defences are:

- **Synchronizer token:** the server stores a random token in the session and the client must return it in a custom header. An attacker's page cannot read it. OWASP recommends this for stateful apps, and TaskVault uses it.
- **Signed double-submit cookie:** the stateless alternative, using an HMAC bound to the session. Libraries such as `csrf-csrf` implement it.
- **`SameSite` cookies:** a valuable additional layer, though OWASP treats it as insufficient on its own in most deployments.
- **Origin and Fetch Metadata checks:** the server checks `Origin` or `Sec-Fetch-Site` to reject cross-site writes. These are growing in popularity and make good additional layers.

Note that **CORS does not prevent CSRF**. CORS controls which origins may read responses and send certain requests, and a plain HTML form never needs CORS approval. Never combine `credentials: true` with an origin setting that reflects any origin.

Bearer tokens in the `Authorization` header are not exposed to CSRF, because the browser never adds them by itself. Only automatically sent credentials create this risk.

#### Why it matters

A forged request can change a password or send money, and in your logs it looks completely legitimate because it carries the victim's valid session.

#### Mental model

Your session cookie is a company stamp that a careless assistant applies to anything put on the desk. The attacker just slips a form onto the desk. A CSRF token is a code word you must also write on each request, which a stranger outside the building cannot know.

#### Code example

First, the attack. Create `demo/attacker.ts`:

```ts
// Classroom only: a page that forges a POST from the victim's browser.
import { createServer } from "node:http";

const TARGET = "http://localhost:3000/tasks/1/complete";

createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html>
<h1>You won a prize!</h1>
<form id="f" method="post" action="${TARGET}"></form>
<script>document.getElementById("f").submit();</script>`);
}).listen(4000, () => console.log("Attacker page on port 4000"));
```

In one terminal, run `npx tsx demo/attacker.ts`. In a browser, log in as Alice using the login `fetch` from Section 9's Console snippet, then try both of these:

- Open `http://127.0.0.1:4000`. It is a different site, so `SameSite=Lax` withholds the cookie, and you see `401`.
- Open `http://localhost:4000`. It is the same site with a different port, so the cookie is sent and the forged request succeeds. Check with `/tasks/1`, where `done` is now `1`. A vulnerable sibling subdomain would have this same position in production.

Now the defence, in `src/middleware/csrf.ts`:

```ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { saveSession } from "../lib/session.js";
import { HttpError } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const issueCsrfToken: RequestHandler = async (req, res) => {
  req.session.csrfToken ??= randomBytes(32).toString("base64url");
  await saveSession(req);
  res.json({ csrfToken: req.session.csrfToken });
};

function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  // Browsers never attach Authorization by themselves, so token requests are not CSRF-able.
  // requireAuth guarantees these requests are never authenticated by the cookie.
  if (req.get("authorization") !== undefined) return next();

  const expected = req.session.csrfToken;
  const received = req.get("x-csrf-token");
  if (!expected || !received || !tokensMatch(expected, received)) {
    throw new HttpError(403, "Invalid CSRF token");
  }
  next();
};
```

- `randomBytes(32)` creates an unguessable token, stored only in the session.
- `req.session.csrfToken ??=` reuses the token throughout the session, which avoids problems with multiple tabs and the back button.
- `SAFE_METHODS` skips reads. This is only safe if `GET` never changes state, so keep it that way.
- `timingSafeEqual` compares in constant time, and it requires equal lengths, hence the length check first.
- The bearer-token skip is safe only because `requireAuth` never falls back to the cookie when an `Authorization` header is present.

Here is the finished `src/app.ts`. Order matters: sessions must exist before CSRF checks, and CSRF checks must run before any route that changes state.

```ts
import express from "express";
import helmet from "helmet";
import { isProduction } from "./config.js";
import { csrfProtection, issueCsrfToken } from "./middleware/csrf.js";
import { errorHandler } from "./middleware/errors.js";
import { sessionMiddleware } from "./middleware/session.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { oidcRouter } from "./routes/oidc.routes.js";
import { tasksRouter } from "./routes/tasks.routes.js";

export const app = express();

if (isProduction) app.set("trust proxy", 1); // exactly one proxy in front of us

app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(sessionMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.get("/auth/csrf", issueCsrfToken);

app.use(csrfProtection);

app.use("/auth/oidc", oidcRouter);
app.use("/auth", authRouter);
app.use("/tasks", tasksRouter);
app.use("/admin", adminRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);
```

Use the token with `curl`. The client flow is: fetch a token, send it on each write, and fetch a new one after login, since login creates a new session and discards the old token.

```bash
rm -f jar.txt
TOKEN=$(curl -s -c jar.txt -b jar.txt http://localhost:3000/auth/csrf | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken')

curl -s -c jar.txt -b jar.txt -X POST http://localhost:3000/auth/login \
  -H "x-csrf-token: $TOKEN" -H "content-type: application/json" \
  -d '{"email":"alice@example.com","password":"correct horse battery staple"}'

TOKEN=$(curl -s -c jar.txt -b jar.txt http://localhost:3000/auth/csrf | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken')

curl -s -b jar.txt -X POST http://localhost:3000/tasks \
  -H "x-csrf-token: $TOKEN" -H "content-type: application/json" -d '{"title":"Protected"}'
```

Update the browser snippet in the same way when you log in:

```js
const csrf = async () => (await (await fetch("/auth/csrf")).json()).csrfToken;
await fetch("/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
  body: JSON.stringify({ email: "alice@example.com", password: "correct horse battery staple" }),
});
```

The login route is protected as well. **Login CSRF** logs a victim into the attacker's account, so anything the victim then saves goes to the attacker.

#### Common beginner mistakes

| Mistake                                           | Symptom                                                                                | Fix                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Reusing the token from before login               | `403 Invalid CSRF token` straight after a successful login                             | Fetch a new token after login               |
| Changing state with `GET`, such as `GET /logout`  | A link or `<img>` can trigger it, and `SameSite=Lax` allows top-level `GET` navigation | Use `POST`, `PATCH` or `DELETE` for changes |
| Assuming a JSON API is immune                     | Body-less routes such as `POST /tasks/1/complete` accept a plain form                  | Protect all state-changing routes           |
| Applying CSRF middleware before the session       | `TypeError` reading `csrfToken`                                                        | Keep the order: session, then CSRF          |
| Using `cors({ origin: true, credentials: true })` | Any site can send credentialed requests and read the responses                         | Use an explicit list of trusted origins     |
| Putting a token in the URL                        | Tokens leak through history, logs and `Referer`                                        | Use a header or a form field                |

#### Try it

Run `npm run seed` to reset the tasks, then reload `http://localhost:4000` with Alice logged in. The forged request now shows `{"error":"Invalid CSRF token"}`, and `/tasks/1` still has `done` set to `0`. Next, request a task-creating `POST` using a valid bearer token and no CSRF token: it should succeed, and you should be able to explain why that is safe.

---

### Section 11: Secrets and dependency hygiene (10 minutes)

#### Explanation

A **secret** is any value that grants access, such as a signing key, database password or API key. Secrets belong outside the codebase and are provided at runtime. In production, use your platform's secret manager rather than a file.

**Dependency hygiene** means managing the third-party code you run. Your `node_modules` is production code that you did not write. OWASP's A03:2025, Software Supply Chain Failures, covers compromised packages, builds and distribution, as well as known-vulnerable versions.

#### Why it matters

Git history keeps secrets indefinitely, so once a key is pushed, assume it is compromised. npm has seen repeated supply chain attacks, from the `crossenv` typosquat in 2017 to the self-propagating Shai-Hulud worm in 2025, which led CISA to urge organisations to review their dependencies. Both attacks targeted developers' machines and credentials, rather than a bug in application logic.

#### Mental model

A secret is your house key: you would not engrave it on the front door, even a private front door. Each dependency is a contractor you have given keys to, and each of their subcontractors too. A lockfile records exactly who was hired, and an audit checks whether any of them has a known problem.

#### Code example

Secrets checklist, already applied in this project:

- `.env` is in `.gitignore`, and `.env.example` documents names only.
- `src/config.ts` fails fast, and prints the names of invalid variables without their values.
- Each purpose has its own key, so `SESSION_SECRET` and `JWT_SECRET` can rotate separately.

**Rotating a session secret without logging everyone out.** `express-session` signs with the first secret and accepts all of them when verifying, so you can add a new one in front and remove the old one later:

```ts
secret: [process.env.SESSION_SECRET_NEW!, process.env.SESSION_SECRET_OLD!],
```

**If a secret is committed:** revoke and replace it first. Then investigate use of the old value, and clean the history if needed. Rewriting history alone does not help, because the value may already have been copied. A scanner such as `gitleaks` in pre-commit hooks and CI catches many of these early.

**Front-end warning.** Any value in a client bundle is public. In Vite, every `VITE_` variable is shipped to browsers, so never give a secret that prefix.

Dependency routine:

```bash
npm ci                      # install exactly what the lockfile says; fail if out of sync
npm audit --omit=dev        # known vulnerabilities in production dependencies
npm audit signatures        # verify registry signatures and provenance where available
npm outdated                # see what has fallen behind
npm ls express              # find out why a package is installed
```

- Commit `package-lock.json`, and use `npm ci` in CI and deployments, never `npm install`.
- Before adding a package, check its spelling, maintenance activity and need. Removing a dependency is the best fix of all.
- Automate update pull requests with Dependabot or Renovate, and let your tests judge them. Consider waiting a few days before adopting new releases, because malicious versions are often caught quickly.
- Install scripts are a major attack route, so OWASP suggests setting `ignore-scripts=true` in `.npmrc`. On the tested versions, `argon2` and `better-sqlite3` both loaded after `npm ci --ignore-scripts`, because they found prebuilt binaries. If a native package on your platform fails to load, run `npm rebuild <package>` for that specific package, once you trust it.

**Logging.** Security logging is OWASP's A09. Record failed logins, `403` responses and CSRF rejections with a user ID and timestamp, and alert on spikes. Never log passwords, tokens, cookies, or full request bodies. Our error handler already keeps stack traces out of responses, which relates to A10.

> **Version note: npm.** Supply chain options are changing quickly, including release-age cooldowns and script allowlists in npm and other package managers. Check the current documentation for your package manager's version before writing them into your team's policy.

#### Common beginner mistakes

| Mistake                                                     | Symptom                                                                                | Fix                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A fallback such as `process.env.JWT_SECRET ?? "dev"`        | Production quietly runs with a public key if the variable is missing                   | Validate at startup and exit                                   |
| Deleting a leaked key in a new commit                       | The key remains in Git history                                                         | Revoke it, then clean up                                       |
| Running `npm audit fix --force` blindly                     | Breaking major upgrades and failed builds                                              | Read the report, and upgrade deliberately with tests           |
| Treating a clean audit as safe                              | `npm audit` lists known issues only, and a brand-new malicious package does not appear | Add lockfiles, slower adoption and limited install scripts     |
| Keeping the lockfile out of Git                             | Different machines install different code                                              | Commit it                                                      |
| `ignore-scripts=true` on a platform with no prebuilt binary | A native module load error at startup                                                  | Run `npm rebuild <package>` for the specific package you trust |

#### Try it

Run `npm audit --omit=dev` and `npm ls --all | wc -l`. How many packages did your 9 direct dependencies bring in? Then search your project with `git grep -n "SECRET"` (run `git init` and `git add .` first if needed) and confirm that no real values appear, then run `git check-ignore .env`.

---

## 4. How the sub-sections connect

**Dependencies.** Each item below relies on the ones above it:

1. **Project setup** provides the deliberately vulnerable API.
2. **AuthN versus AuthZ** provides the vocabulary and middleware shape for everything else.
3. **Password hashing** supplies the evidence for authentication.
4. **Sessions** hold the result of authentication across requests, for browsers.
5. **JWT** holds the same result in another form, for non-browser clients. It also prepares learners for ID tokens.
6. **OAuth and OIDC concepts** explain delegating login to a provider, which depends on JWT and redirect knowledge.
7. **OIDC implementation** ends in the same session as Section 3.
8. **Ownership and mass assignment** are the authorisation half, and they need a trustworthy `req.user`.
9. **Injection** can bypass all of the above at the data layer.
10. **XSS** runs code as the user, bypassing authentication at the browser layer.
11. **CSRF** abuses automatically sent cookies, and it depends on Section 3's cookie knowledge. XSS can defeat it, so XSS comes first.
12. **Secrets and dependencies** protect the keys and code that all earlier sections rely on.

**Hierarchy.**

- **Identity:** passwords, sessions, JWT, OIDC.
- **Permission:** roles, ownership, field allowlists.
- **Untrusted input and output:** injection, XSS.
- **Browser behaviour:** cookies, `SameSite`, CSRF, CSP.
- **Foundations:** configuration, secrets, dependencies, logging.

**Request pipeline (useful for your diagram).** `helmet` → body parser → session → CSRF check → router → `requireAuth` → `requireRole` → validation → scoped query → encoded response → error handler.

**Suggested live-teaching flow.** Use a "break it, then fix it" rhythm. Demonstrate each attack, then let learners write the fix.

| Time | Section        | Instructor demo                                | Learners code                            |
| ---- | -------------- | ---------------------------------------------- | ---------------------------------------- |
| 0:00 | 0: Setup       | Tour of the broken API                         | Scaffold and seed the project            |
| 0:10 | 1: AuthN/AuthZ | Impersonate Alice with a header                | Add the admin route                      |
| 0:20 | 2: Hashing     | Show two hashes of one password                | `password.ts`, updated seed              |
| 0:35 | 3: Sessions    | Inspect `Set-Cookie` in dev tools              | Session middleware and auth routes       |
| 0:55 | 4: JWT         | Decode a token with no key, and tamper with it | `jwt.ts`, updated `requireAuth`          |
| 1:10 | Break          |                                                |                                          |
| 1:20 | 5: OAuth/OIDC  | Walk through the flow and discovery document   | Read the discovery document              |
| 1:30 | 6: OIDC code   | Full login against the mock provider           | `oidc.routes.ts`, tamper with `state`    |
| 1:45 | 7: Ownership   | Bob reads Alice's task                         | Shared lookup and strict schemas         |
| 2:05 | 8: Injection   | `UNION` pulls password hashes                  | Parameterised search and sort allowlist  |
| 2:20 | 9: XSS         | Alert from a task title                        | `escapeHtml`, `helmet`, CSP check        |
| 2:30 | 10: CSRF       | Forged form from port 4000                     | CSRF middleware and client flow          |
| 2:45 | 11: Hygiene    | Run the audit commands together                | Check their own project                  |
| 2:55 | Wrap-up        | Recap with the request pipeline                | Questions 1 and 2 of the knowledge check |

If you run short of time, demonstrate Section 6 without having learners type it, because Sections 7 to 10 give the most value from hands-on practice. Assign the remaining questions and the mini-exercise as homework.

---

## 5. Key terms glossary

In order of first appearance:

- **Authentication (AuthN):** verifying who a user or system is.
- **Authorisation (AuthZ):** deciding what an identified user may do.
- **Stateless:** each HTTP request is handled without built-in memory of earlier requests.
- **Hashing:** a one-way transformation of data into a fixed-format output.
- **Encryption:** a reversible transformation that requires a key.
- **Salt:** a unique random value mixed into each password hash.
- **Work factor:** a setting that controls how expensive a hash is to compute.
- **Argon2id:** a memory-hard password hashing algorithm, and OWASP's first choice.
- **Memory-hard:** requiring substantial RAM per computation, which limits cheap parallel cracking.
- **Session:** login state stored on the server and referenced by an ID.
- **Session ID:** the random identifier a browser presents, usually in a cookie.
- **Session fixation:** forcing a victim to use a session ID that the attacker already knows.
- **JSON Web Token (JWT):** a signed, Base64URL-encoded set of claims.
- **Claim:** a statement inside a token, such as `sub` or `exp`.
- **Bearer token:** a credential that works for whoever holds it.
- **Symmetric signing:** signing and verifying with the same secret.
- **Asymmetric signing:** signing with a private key and verifying with a public key.
- **JWKS:** a published set of public keys used to verify tokens.
- **Refresh token:** a longer-lived credential used to obtain new access tokens.
- **Rotation:** replacing a credential or key, including on each use for refresh tokens.
- **OAuth 2.0:** a framework for delegated authorisation.
- **OpenID Connect (OIDC):** an identity layer built on OAuth 2.0.
- **Confidential client:** an app that can keep a secret, usually on a server.
- **Public client:** an app that cannot keep a secret, such as a browser or mobile app.
- **Authorization server / OpenID Provider:** the system that authenticates users and issues tokens.
- **Resource server:** an API that accepts access tokens.
- **ID token:** a signed JWT telling a client who logged in.
- **Access token:** a credential for calling a resource server.
- **Redirect URI:** the registered address to which a provider returns the user.
- **State:** a random value that binds a callback to the browser session that started the login.
- **Nonce:** a random value that binds an ID token to one login attempt.
- **PKCE:** a proof that the party redeeming an authorization code is the party that requested it.
- **Discovery document:** a provider's published list of endpoints and capabilities.
- **Backend-for-frontend:** a server that handles tokens on behalf of a browser app.
- **Open redirect:** an endpoint that sends users to an attacker-chosen URL.
- **OWASP Top 10:** an awareness list of the most critical web application risk categories.
- **IDOR / BOLA:** accessing another user's object by changing its identifier.
- **Mass assignment:** copying client-supplied fields into a record without an allowlist.
- **Injection:** untrusted input being interpreted as commands.
- **Parameterised query:** a query that sends its structure and values separately.
- **Least privilege:** granting only the access that is needed.
- **Cross-site scripting (XSS):** attacker-controlled script running in a victim's browser on your origin.
- **Output encoding:** converting data so that it renders as text in its context.
- **Content Security Policy (CSP):** a header that restricts which resources a page may load or run.
- **Cross-site request forgery (CSRF):** tricking a browser into sending an authenticated, unintended request.
- **Origin:** the combination of scheme, host and port.
- **Site:** broadly, the scheme and registrable domain, ignoring ports and subdomains.
- **Synchronizer token:** a session-stored random token that the client must send on writes.
- **Login CSRF:** forcing a victim's browser to log in to an attacker's account.
- **CORS:** a browser mechanism that controls cross-origin access to responses. It is not a CSRF defence.
- **Secret:** a value that grants access, such as a key or password.
- **Supply chain attack:** compromising software through its dependencies or build process.
- **Lockfile:** a file that records the exact versions of all dependencies.

---

## 6. Knowledge check

**Question 1 (recall).** What status code should TaskVault return in each case, and why?

a. No cookie and no token, calling `GET /tasks`.
b. Bob, logged in as a member, calling `GET /admin/users`.
c. Bob calling `GET /tasks/1`, which belongs to Alice.

**Question 2 (predict the output).** `signAccessToken` is the function from Section 4. What is printed?

```ts
import { decodeJwt } from "jose";
import { signAccessToken, verifyAccessToken } from "./security/jwt.js";

const token = await signAccessToken(1);
const [header, payload, signature] = token.split(".");

const forged = Buffer.from(JSON.stringify({ ...decodeJwt(token), sub: "2" })).toString("base64url");
const tampered = `${header}.${forged}.${signature}`;

console.log(decodeJwt(tampered).sub);
console.log(await verifyAccessToken(tampered).catch((err) => err.code));
```

**Question 3 (predict the output).** Alice has one task, titled `Pay rent`. What does each query return?

```ts
const input = "' OR 1=1 --";

const a = db
  .prepare(`SELECT title FROM tasks WHERE owner_id = 1 AND title LIKE ?`)
  .all(`%${input}%`);

const b = db
  .prepare(`SELECT title FROM tasks WHERE title LIKE '%${input}%'`)
  .all();
```

Assume Bob also has one task, titled `Buy groceries`.

**Question 4 (spot the bugs).** This login route has three security bugs. Find them.

```ts
authRouter.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = findUserByEmail(email);
  if (!user) throw new HttpError(401, "No account with that email");

  const valid = verifyPassword(user.password_hash, password);
  if (!valid) throw new HttpError(401, "Wrong password");

  req.session.userId = user.id;
  res.json({ id: user.id });
});
```

**Question 5 (spot the bugs).** This route has at least three problems. Find them and write the fix.

```ts
tasksRouter.patch("/:id", (req, res) => {
  db.prepare(`UPDATE tasks SET title = '${req.body.title}' WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});
```

### Applied mini-exercise: secure comments

Add comments to tasks. A teammate wrote this first draft. Add it to the end of `src/routes/tasks.routes.ts`, then secure it.

**Starter code**

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id        INTEGER PRIMARY KEY,
    task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body      TEXT NOT NULL
  );
`);

interface CommentRow {
  id: number;
  task_id: number;
  author_id: number;
  body: string;
}

tasksRouter.post("/:id/comments", (req, res) => {
  const row = { task_id: req.params.id, author_id: req.user!.id, ...req.body };
  const result = db
    .prepare("INSERT INTO comments (task_id, author_id, body) VALUES (@task_id, @author_id, @body)")
    .run(row);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

tasksRouter.get("/:id/comments", (req, res) => {
  const search = String(req.query.search ?? "");
  const rows = db
    .prepare(`SELECT * FROM comments WHERE task_id = ${req.params.id} AND body LIKE '%${search}%'`)
    .all();
  res.json(rows);
});

tasksRouter.get("/:id/comments.html", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM comments WHERE task_id = ?")
    .all(req.params.id) as CommentRow[];
  const items = rows.map((row) => `<li>${row.body}</li>`).join("");
  res.type("html").send(`<!doctype html><ul>${items}</ul>`);
});
```

**Requirements**

1. Only a task's owner or an admin can create or read its comments.
2. The request body accepts `body` only, trimmed, with a length from 1 to 1000 characters.
3. All SQL uses placeholders, and the search term is limited to 100 characters.
4. The HTML route renders comments as text, never as markup.

**Acceptance criteria**

- Bob gets `404` from all three routes on Alice's task.
- `{"body":"hi","author_id":2}` and `{"body":"   "}` each get `400`.
- `?search=' OR 1=1 --` returns `[]` when no comment contains that text.
- A comment containing `<script>x</script>` appears in the HTML response as `&lt;script&gt;x&lt;/script&gt;`.
- `POST` without a CSRF token gets `403` when using a session cookie.
- `npm run typecheck` passes.

---

## 7. Summary recap

- **Separate the two questions.** Authentication establishes who someone is, and authorisation must then be checked at the function, object and property levels on the server.
- **Protect credentials with purpose-built tools.** Hash passwords with Argon2id, regenerate session IDs at login, and set `HttpOnly`, `Secure` and `SameSite` deliberately.
- **Choose the token model that fits.** Sessions suit your own browser front end, while short-lived, strictly verified JWTs suit other clients. Delegate sign-in with OIDC using the authorization code flow, PKCE and a certified library.
- **Scope every query to the user.** Ownership in the `WHERE` clause and allowlist schemas stop the most common API vulnerabilities.
- **Keep data and instructions apart.** Parameterise SQL, encode output for its context, and use CSP as a backup. Protect cookie-authenticated writes with CSRF tokens.
- **Your keys and dependencies are part of your attack surface.** Validate configuration at startup, keep secrets out of Git, commit lockfiles, and treat every package as code you run in production.

---

## 8. Next lesson bridge

TaskVault now has a working security model, but its protections were checked by hand and it still stores sessions in memory. Next, you can turn today's attacks into automated regression tests, and move sessions and rate limits into a shared store. Those steps prepare the API for a real HTTPS deployment, where `Secure` cookies, `trust proxy` and your secret manager all come into play.

---

## Appendix A: Final `src/routes/tasks.routes.ts`

```ts
import { Router, type Request } from "express";
import { z } from "zod";
import { db, type TaskRow } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { escapeHtml } from "../lib/html.js";
import { requireAuth } from "../middleware/auth.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const idSchema = z.coerce.number().int().positive();

const listSchema = z.object({
  search: z.string().max(100).default(""),
  sort: z.enum(["id", "title"]).default("id"),
});

const createSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).default(""),
});

const updateSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(5000).optional(),
    done: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0);

// Every read or write of a single task goes through this one function.
function getTaskForRequest(req: Request): TaskRow {
  const taskId = idSchema.parse(req.params.id);
  const user = req.user!;
  const task =
    user.role === "admin"
      ? db.prepare<[number], TaskRow>("SELECT * FROM tasks WHERE id = ?").get(taskId)
      : db
          .prepare<[number, number], TaskRow>("SELECT * FROM tasks WHERE id = ? AND owner_id = ?")
          .get(taskId, user.id);
  if (!task) throw new HttpError(404, "Not found");
  return task;
}

// Escape the LIKE wildcards so "%" and "_" are searched for literally.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

const SORT_COLUMNS = { id: "id", title: "title COLLATE NOCASE" } as const;

tasksRouter.get("/", (req, res) => {
  const { search, sort } = listSchema.parse(req.query);
  const rows = db
    .prepare<[number, string], TaskRow>(
      `SELECT * FROM tasks
       WHERE owner_id = ? AND title LIKE ? ESCAPE '\\'
       ORDER BY ${SORT_COLUMNS[sort]}`,
    )
    .all(req.user!.id, likePattern(search));
  res.json(rows);
});

tasksRouter.post("/", (req, res) => {
  const { title, notes } = createSchema.parse(req.body);
  const result = db
    .prepare("INSERT INTO tasks (owner_id, title, notes) VALUES (?, ?, ?)")
    .run(req.user!.id, title, notes);
  res.status(201).json({ id: Number(result.lastInsertRowid), title, notes, done: false });
});

tasksRouter.get("/:id", (req, res) => {
  res.json(getTaskForRequest(req));
});

tasksRouter.patch("/:id", (req, res) => {
  const task = getTaskForRequest(req);
  const body = updateSchema.parse(req.body);
  db.prepare("UPDATE tasks SET title = ?, notes = ?, done = ? WHERE id = ?").run(
    body.title ?? task.title,
    body.notes ?? task.notes,
    body.done === undefined ? task.done : Number(body.done),
    task.id,
  );
  res.json(getTaskForRequest(req));
});

tasksRouter.post("/:id/complete", (req, res) => {
  const task = getTaskForRequest(req);
  db.prepare("UPDATE tasks SET done = 1 WHERE id = ?").run(task.id);
  res.status(204).end();
});

tasksRouter.delete("/:id", (req, res) => {
  const task = getTaskForRequest(req);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  res.status(204).end();
});

tasksRouter.get("/:id/preview", (req, res) => {
  const task = getTaskForRequest(req);
  res
    .type("html")
    .send(`<!doctype html><h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(task.notes)}</p>`);
});
```

## Appendix B: Final file tree

```text
taskvault/
├── .env                 (never committed)
├── .env.example
├── .gitignore
├── demo/attacker.ts     (classroom only)
├── package.json
├── package-lock.json
├── tsconfig.json
└── src/
    ├── app.ts
    ├── config.ts
    ├── db.ts
    ├── express.d.ts
    ├── seed.ts
    ├── server.ts
    ├── lib/        errors.ts, html.ts, session.ts
    ├── middleware/ auth.ts, csrf.ts, errors.ts, session.ts
    ├── routes/     admin.routes.ts, auth.routes.ts, oidc.routes.ts, tasks.routes.ts
    └── security/   jwt.ts, password.ts
```

Delete `src/routes/tasks.vulnerable.ts` once Section 9 is complete.

## Appendix C: Sources

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/0x00_2025-Introduction/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html)
- [OWASP NPM Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html)
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
- [The Record: CISA urges review after Shai-Hulud compromise](https://therecord.media/cisa-urges-software-reviews-malicious-packages)

---

## Instructor answer key

**Question 1.**

a. `401`: there is no identity.
b. `403`: the identity is known, and the role is not allowed.
c. `404`: the query is scoped to Bob's tasks, so the row is not found. This also avoids confirming that task 1 exists.

**Question 2.**

```text
2
ERR_JWS_SIGNATURE_VERIFICATION_FAILED
```

`decodeJwt` only reads the payload, so it happily reports the attacker's `sub`. `jwtVerify` recomputes the signature, which no longer matches. Lesson: decoding is not verifying.

**Question 3.**

- `a` returns `[]`. The input is a value, so the query looks for titles that literally contain `' OR 1=1 --`.
- `b` returns both tasks. The quote ends the string, `OR 1=1` matches every row, and `--` comments out the rest.

**Question 4.**

1. **Missing `await`:** `verifyPassword` returns a Promise, which is always truthy, so any password logs in.
2. **User enumeration:** different messages reveal whether an email exists, and the early return creates a timing difference. Use one message and always call `verifyPassword`, passing `null` for an unknown user.
3. **Session fixation:** there is no `regenerateSession` before setting `userId`.

Also acceptable: there is no rate limiter, which leaves the route open to password guessing.

**Question 5.**

The problems are SQL injection in `title`, no ownership check (any user can edit any task), and no validation of `title` or `id`.

```ts
tasksRouter.patch("/:id", (req, res) => {
  const task = getTaskForRequest(req);
  const { title } = z.strictObject({ title: z.string().trim().min(1).max(200) }).parse(req.body);
  db.prepare("UPDATE tasks SET title = ? WHERE id = ?").run(title, task.id);
  res.status(204).end();
});
```

### Mini-exercise model solution

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id        INTEGER PRIMARY KEY,
    task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body      TEXT NOT NULL
  );
`);

interface CommentRow {
  id: number;
  task_id: number;
  author_id: number;
  body: string;
}

const commentSchema = z.strictObject({
  body: z.string().trim().min(1).max(1000),
});

tasksRouter.post("/:id/comments", (req, res) => {
  const task = getTaskForRequest(req);
  const { body } = commentSchema.parse(req.body);
  const result = db
    .prepare("INSERT INTO comments (task_id, author_id, body) VALUES (?, ?, ?)")
    .run(task.id, req.user!.id, body);
  res.status(201).json({ id: Number(result.lastInsertRowid), body });
});

tasksRouter.get("/:id/comments", (req, res) => {
  const task = getTaskForRequest(req);
  const search = z.string().max(100).default("").parse(req.query.search);
  const rows = db
    .prepare<[number, string], CommentRow>(
      "SELECT * FROM comments WHERE task_id = ? AND body LIKE ? ESCAPE '\\' ORDER BY id",
    )
    .all(task.id, likePattern(search));
  res.json(rows);
});

tasksRouter.get("/:id/comments.html", (req, res) => {
  const task = getTaskForRequest(req);
  const rows = db
    .prepare<[number], CommentRow>("SELECT * FROM comments WHERE task_id = ? ORDER BY id")
    .all(task.id);
  const items = rows.map((row) => `<li>${escapeHtml(row.body)}</li>`).join("");
  res.type("html").send(`<!doctype html><ul>${items}</ul>`);
});
```

**Marking notes**

- The first line of each route is `getTaskForRequest(req)`. This one call meets requirement 1, and it also validates the ID.
- `task.id` replaces `req.params.id` in every query, so only the validated number is used.
- `commentSchema` is strict, so `author_id` and `task_id` cannot be supplied by the client.
- `likePattern` and `ESCAPE` make a search for `%` literal. Accept solutions without this if they use placeholders, but mention the behaviour.
- CSRF needs no new code, because the global middleware already covers the new `POST`. Ask learners to explain why.

**Common wrong answers to watch for:** stripping `<script>` instead of encoding; checking `author_id` instead of task ownership, which blocks an admin and misses the actual policy; and silently dropping an empty comment instead of returning `400`.