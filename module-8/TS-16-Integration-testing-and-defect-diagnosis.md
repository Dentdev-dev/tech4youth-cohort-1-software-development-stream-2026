# Testing, End-to-End Checks and Observability for Express + TypeScript

**Format:** 3-hour, project-based session
**Prior lessons:** Node.js, Express
**Project:** `task-api`, a small multi-workspace task API that we test, trace, debug and document

---

## Assumptions (read first)

The template you supplied still contains React/Vite wording (for example "new to React", the `react-ts` template, `.tsx`). I treated that as leftover text and adapted it to this topic: the stack is **Node.js + Express + TypeScript**, all code is `.ts`, and the "vanilla vs framework" bridges compare against the **frontend skills learners already have** (DOM tests, `fetch`, browser DevTools). Other assumptions:

- Learners can already build Express routes and structure a small backend.
- **Test runner:** Vitest. **HTTP assertions:** Supertest. **E2E:** Playwright (`@playwright/test`). **Logging:** pino. `tsx` runs TypeScript directly.
- The app uses an **in-memory repository** so no database setup eats into the 3 hours. The same patterns apply to a real DB.
- Playwright is used here mainly through its **API testing** (`request` fixture), which is the right e2e layer for a backend-only service. A browser stretch task is in section 4.

> **Version note (verify before teaching):** I could not check live package versions while writing. Install the latest stable of each and confirm these points:
> - **Express 5** is assumed (async handler errors reach the error middleware automatically; `req.body` is `undefined` when no body parser ran).
> - **Node 22+** is assumed (`AsyncLocalStorage.bind`, `--import tsx`).
> - Vitest CLI flags for debugging (`--no-file-parallelism`, `--inspect-brk`) have changed between majors.
> - Playwright's `webServer`, `request` fixture and trace viewer options are stable, but check the current docs for config key names.

### Suggested timing (180 min)

| Time      | Section                                                     | Mode                         |
| --------- | ----------------------------------------------------------- | ---------------------------- |
| 0:00–0:15 | 1. Project setup and the testing map                        | Demo + setup                 |
| 0:15–0:55 | 2. Unit tests and TDD through one example                   | Live coding, learners follow |
| 0:55–1:20 | 3. Integration and API tests with Supertest                 | Demo, then learners extend   |
| 1:20–1:30 | Break                                                       |                              |
| 1:30–2:05 | 4 and 5. Playwright, fixtures, isolated data, failure paths | Learners code                |
| 2:05–2:35 | 6. Request tracing and structured logs                      | Demo, then learners code     |
| 2:35–2:48 | 7. Debugging and regression checks                          | Bug hunt                     |
| 2:48–3:00 | 8. Documentation, wrap-up                                   | Short                        |

The applied exercise in the knowledge check is homework, or use leftover minutes.

---

## 1. Learning objectives

By the end, learners will be able to:

1. **Build** a test suite with unit, integration and API-level tests, and explain what each layer is for and costs.
2. **Apply** red-green-refactor to implement a business rule with test-driven development (TDD).
3. **Write** Playwright end-to-end tests that use fixtures, isolated data and assert critical failure paths (bad input, duplicates, missing records, server errors).
4. **Trace** a request through the system using a request ID and structured JSON logs.
5. **Debug** a reported bug by reproducing it from logs, writing a failing regression test, fixing it and documenting the outcome.

---

## 2. Prerequisite check

Learners must already know:

- Express routing, middleware order and error-handling middleware (`(err, req, res, next)`).
- `async/await`, Promises and how a rejected Promise surfaces as an error.
- TypeScript interfaces, generics basics and `import type`.
- How to run npm scripts and read a stack trace.
- HTTP status codes (200/201/400/404/409/500) and JSON bodies.

**Where this fits:** this lesson comes after you can build an API. It teaches you to *prove* it works, to *keep* proving it as it changes, and to *see inside it* when it breaks in production.

---

## 3. Section breakdown

### Section 1: Project setup and the testing map (15 min)

**Explanation.** A **test** is code that runs your code and checks the result. Three layers matter here:

| Layer                 | What runs                                                                          | Speed        | Fails when                                                   |
| --------------------- | ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| **Unit**              | One function or service, with fakes for dependencies                               | milliseconds | Business logic is wrong                                      |
| **Integration / API** | The Express app in-process (no network port), real middleware and routes           | tens of ms   | Wiring, status codes, JSON shape, middleware order are wrong |
| **End-to-end (e2e)**  | The real server started as a separate process, driven over real HTTP by Playwright | seconds      | The deployed shape of the system is wrong                    |

The test pyramid says: many unit tests, fewer integration tests, a small number of e2e tests covering critical paths.

**Why it matters.** Tests are what let you change code on Friday without fear. Fast layers catch most bugs cheaply; slow layers catch the integration bugs the fast ones cannot.

**Mental model.** From the frontend: a unit test is like calling a pure helper in the console. An integration test is like rendering a component without a browser. An e2e test is like clicking through the real site. Same trade-off: realism versus speed.

**Code example.** Scaffold:

```bash
mkdir task-api && cd task-api
npm init -y
npm i express pino
npm i -D typescript tsx vitest supertest @playwright/test @types/express @types/node @types/supertest
```

`package.json` (merge these keys):

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "check": "npm run typecheck && npm run test && npm run test:e2e"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "e2e", "*.ts"]
}
```

`vitest.config.ts` (so Vitest never picks up Playwright's `.spec.ts` files):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
```

Starter files (learners paste these; they are not the lesson):

`src/lib/errors.ts`

```ts
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}
export class ValidationError extends AppError {
  constructor(message: string) { super(400, "VALIDATION_ERROR", message); }
}
export class NotFoundError extends AppError {
  constructor(message: string) { super(404, "NOT_FOUND", message); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(409, "CONFLICT", message); }
}
```

`src/domain/task.ts`

```ts
export interface Task {
  id: string;
  workspace: string; // lets many users/tests share one server without seeing each other's data
  title: string;
  done: boolean;
  createdAt: string; // ISO string
}
```

`src/repositories/taskRepository.ts`

```ts
import type { Task } from "../domain/task";

export interface TaskRepository {
  insert(task: Task): Promise<Task>;
  findById(workspace: string, id: string): Promise<Task | undefined>;
  list(workspace: string): Promise<Task[]>;
  update(task: Task): Promise<Task>;
}
```

`src/repositories/inMemoryTaskRepository.ts`

```ts
import type { Task } from "../domain/task";
import type { TaskRepository } from "./taskRepository";

export class InMemoryTaskRepository implements TaskRepository {
  private tasks = new Map<string, Task>();

  async insert(task: Task) { this.tasks.set(task.id, task); return task; }
  async findById(workspace: string, id: string) {
    const t = this.tasks.get(id);
    return t?.workspace === workspace ? t : undefined;
  }
  async list(workspace: string) {
    return [...this.tasks.values()].filter((t) => t.workspace === workspace);
  }
  async update(task: Task) { this.tasks.set(task.id, task); return task; }
}
```

Commentary: the service will depend on the `TaskRepository` **interface**, not the Map. That single decision (**dependency injection**: passing dependencies in rather than importing them) is what makes unit tests fast and failure tests possible later.

**Common beginner mistakes.**
- *Symptom:* `Error: Cannot find module './foo.js'` or `ERR_MODULE_NOT_FOUND` when running compiled output. *Fix:* we run through `tsx` and `moduleResolution: "Bundler"`, so extensionless imports work here. Production build setup is a later lesson.
- *Symptom:* Vitest runs Playwright specs and crashes with "Playwright Test did not expect test() to be called here". *Fix:* the `include`/`exclude` in `vitest.config.ts`.

**Try it (3 min).** Create `src/hello.test.ts` with `it("works", () => expect(1 + 1).toBe(2))`, run `npm test`, then delete the file.

---

### Section 2: Unit tests and TDD through one example (40 min)

**Explanation.** **TDD** (test-driven development) is a loop: **Red** (write a failing test), **Green** (write the least code to pass), **Refactor** (clean up while tests stay green). A **unit test** here targets the `TaskService`, a plain function with no Express in sight. A **fake** is a simple stand-in for a real dependency (our in-memory repo; a fixed clock; a counter for IDs).

**The one example:** the rule *"creating a task"*.

1. Trims the title.
2. Rejects an empty (after trimming) or non-string title.
3. Rejects titles over 100 characters.
4. Rejects a duplicate title among the workspace's **open** tasks (case-insensitive).
5. Allows re-using a title once the earlier task is completed.

**Why it matters.** Rules like these are where real bugs live. Writing the test first forces you to decide the behaviour before the code, and leaves a safety net that makes refactoring cheap.

**Mental model.** Like writing the `expect` for a DOM helper before the helper, then adjusting until the console shows green. Determinism matters: `Date.now()` and random UUIDs make tests flaky, so we **inject** a clock and an ID generator.

**Code example.**

`src/services/taskService.test.ts`, start with the helper and **Cycle 1**:

```ts
import { describe, expect, it } from "vitest";
import { createTaskService } from "./taskService";
import { InMemoryTaskRepository } from "../repositories/inMemoryTaskRepository";
import { ConflictError, ValidationError } from "../lib/errors";

function setup() {
  const repo = new InMemoryTaskRepository();
  let n = 0;
  const service = createTaskService(repo, {
    newId: () => `id-${++n}`,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  return { repo, service };
}

describe("TaskService.create", () => {
  it("creates a task with a trimmed title", async () => {
    const { service } = setup();
    const task = await service.create("w1", { title: "  Buy milk  " });
    expect(task).toEqual({
      id: "id-1",
      workspace: "w1",
      title: "Buy milk",
      done: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
```

**Red.** Run `npm test`. It fails because `./taskService` does not exist. That is a valid red: the failure is for the right reason (missing behaviour).

**Green, minimal.** `src/services/taskService.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Task } from "../domain/task";
import type { TaskRepository } from "../repositories/taskRepository";

export interface ServiceDeps {
  newId?: () => string;
  now?: () => Date;
}

export function createTaskService(repo: TaskRepository, deps: ServiceDeps = {}) {
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date());

  return {
    async create(workspace: string, input: { title: unknown }): Promise<Task> {
      const title = String(input.title).trim();
      return repo.insert({ id: newId(), workspace, title, done: false, createdAt: now().toISOString() });
    },
  };
}
export type TaskService = ReturnType<typeof createTaskService>;
```

This is deliberately naive (`String(...)`). The next tests will expose that.

**Cycle 2 (Red):** validation.

```ts
  it.each([
    ["empty string", ""],
    ["only spaces", "   "],
    ["a number", 42],
    ["undefined", undefined],
  ])("rejects %s as a title", async (_label, title) => {
    const { service } = setup();
    await expect(service.create("w1", { title })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects titles longer than 100 characters", async () => {
    const { service } = setup();
    await expect(service.create("w1", { title: "x".repeat(101) })).rejects.toThrow(/at most 100/);
  });
```

Run: red (`String(42)` is "42" and gets accepted). **Green:** add validation.

**Cycle 3 (Red):** duplicates and completion.

```ts
  it("rejects a duplicate open title, ignoring case", async () => {
    const { service } = setup();
    await service.create("w1", { title: "Buy milk" });
    await expect(service.create("w1", { title: "BUY MILK" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows the same title in a different workspace", async () => {
    const { service } = setup();
    await service.create("w1", { title: "Buy milk" });
    await expect(service.create("w2", { title: "Buy milk" })).resolves.toMatchObject({ workspace: "w2" });
  });

  it("allows re-using a title after the first task is completed", async () => {
    const { service } = setup();
    const first = await service.create("w1", { title: "Buy milk" });
    await service.complete("w1", first.id);
    await expect(service.create("w1", { title: "Buy milk" })).resolves.toMatchObject({ done: false });
  });
```

**Green + Refactor:** the final service (note the extracted `validateTitle`):

```ts
import { randomUUID } from "node:crypto";
import type { Task } from "../domain/task";
import type { TaskRepository } from "../repositories/taskRepository";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";

const MAX_TITLE = 100;

export interface ServiceDeps {
  newId?: () => string;
  now?: () => Date;
}

function validateTitle(raw: unknown): string {
  if (typeof raw !== "string") throw new ValidationError("title must be a string");
  const title = raw.trim();
  if (title.length === 0) throw new ValidationError("title must not be empty");
  if (title.length > MAX_TITLE) throw new ValidationError(`title must be at most ${MAX_TITLE} characters`);
  return title;
}

export function createTaskService(repo: TaskRepository, deps: ServiceDeps = {}) {
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? (() => new Date());

  return {
    async create(workspace: string, input: { title: unknown }): Promise<Task> {
      const title = validateTitle(input.title);
      const open = (await repo.list(workspace)).filter((t) => !t.done);
      if (open.some((t) => t.title.toLowerCase() === title.toLowerCase())) {
        throw new ConflictError(`an open task titled "${title}" already exists`);
      }
      return repo.insert({ id: newId(), workspace, title, done: false, createdAt: now().toISOString() });
    },

    async list(workspace: string): Promise<Task[]> {
      return repo.list(workspace);
    },

    async complete(workspace: string, id: string): Promise<Task> {
      const task = await repo.findById(workspace, id);
      if (!task) throw new NotFoundError(`task ${id} not found`);
      return repo.update({ ...task, done: true });
    },
  };
}
export type TaskService = ReturnType<typeof createTaskService>;
```

Line-by-line points to narrate:
- `input: { title: unknown }`: input from the network is **untrusted**, so we type it `unknown` and narrow it. TypeScript types vanish at runtime; validation does not.
- `validateTitle` returns the cleaned value, so later code never touches the raw input.
- `complete` is needed by cycle 3's last test; write it test-first too if time allows (a one-line red test: completing an unknown id throws `NotFoundError`).
- After the refactor, run `npm test`. All green means the refactor was safe. That is the point of the loop.

**Common beginner mistakes.**
- *Writing all tests, then all code.* That is test-first, not TDD. Do one red at a time.
- *Forgetting `await` before `expect(...).rejects`.* *Symptom:* the test passes even when the code is wrong, or you see an unhandled rejection later. *Fix:* always `await expect(promise).rejects...`.
- *Using `Date.now()`/`randomUUID()` directly in the code under test.* *Symptom:* tests that fail randomly or need regex matching on IDs. *Fix:* inject the clock and ID generator.
- *Testing implementation, not behaviour* (for example asserting that `repo.list` was called). *Fix:* assert outputs and visible effects.

**Try it (5 min).** TDD one new rule: titles are stored without leading/trailing whitespace **and** with internal runs of whitespace collapsed (`"Buy   milk"` becomes `"Buy milk"`). Write the red test first, then the one-line fix.

---

### Section 3: Integration and API tests with Supertest (25 min)

**Explanation.** An **integration test** exercises several real pieces together. An **API test** is an integration test aimed at the HTTP contract: status codes, headers, JSON shape and error format. **Supertest** calls your Express `app` object directly, with no port opened, so it is fast and parallel-safe.

**Why it matters.** Unit tests do not notice that you mounted the router at the wrong path, put `express.json()` after the routes, or returned a 200 where the contract says 201.

**Mental model.** In the browser you `fetch("/tasks", { method: "POST", body })` and inspect `res.status` and `await res.json()`. Supertest is that `fetch`, but aimed straight at your app in memory.

**Code example.** To make the app testable, build it with a **factory** (`createApp`) that accepts dependencies.

`src/lib/logger.ts` (we expand its role in section 6):

```ts
import pino from "pino";
import { getRequestId } from "../middleware/requestContext";

export type Logger = pino.Logger;

export function createLogger(stream?: { write(chunk: string): void }, level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino(
    {
      level,
      // mixin runs on every log call; it stamps the current request id onto each line
      mixin() {
        const requestId = getRequestId();
        return requestId ? { requestId } : {};
      },
    },
    stream,
  );
}
```

`src/middleware/requestContext.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const storage = new AsyncLocalStorage<{ requestId: string }>();

export const getRequestId = (): string | undefined => storage.getStore()?.requestId;

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", requestId);
  storage.run({ requestId }, next);
};
```

`src/middleware/accessLog.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import type { Logger } from "../lib/logger";

export const accessLog = (logger: Logger): RequestHandler => (req, res, next) => {
  const start = process.hrtime.bigint();
  // Event-emitter callbacks do not always keep the request context, so bind explicitly.
  res.on(
    "finish",
    AsyncLocalStorage.bind(() => {
      logger.info(
        {
          method: req.method,
          route: req.route ? req.baseUrl + req.route.path : "unmatched",
          status: res.statusCode,
          durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
        },
        "request completed",
      );
    }),
  );
  next();
};
```

`src/middleware/errorHandler.ts`:

```ts
import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, NotFoundError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import { getRequestId } from "./requestContext";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`route ${req.method} ${req.path} not found`));
};

export const errorHandler = (logger: Logger): ErrorRequestHandler => (err, _req, res, _next) => {
  const requestId = getRequestId();

  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, requestId } });
    return;
  }

  // body-parser errors (malformed JSON) carry a `type`; this is a client mistake, not a server fault
  if ((err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "request body is not valid JSON", requestId } });
    return;
  }

  logger.error({ err }, "unhandled error");
  // Never send err.message to clients: it can leak internals.
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong", requestId } });
};
```

`src/routes/tasks.ts`:

```ts
import { Router, type Request } from "express";
import { ValidationError } from "../lib/errors";
import type { TaskService } from "../services/taskService";

function workspaceOf(req: Request): string {
  const ws = req.header("x-workspace") ?? "default";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ws)) throw new ValidationError("x-workspace must be 1-64 letters, digits, _ or -");
  return ws;
}

export function tasksRouter(service: TaskService) {
  const router = Router();

  router.post("/", async (req, res) => {
    const task = await service.create(workspaceOf(req), { title: req.body.title });
    res.status(201).json(task);
  });

  router.get("/", async (req, res) => {
    res.json(await service.list(workspaceOf(req)));
  });

  router.post("/:id/complete", async (req, res) => {
    res.json(await service.complete(workspaceOf(req), req.params.id));
  });

  return router;
}
```

> **Instructor note:** `req.body.title` above is intentionally the version we will find a bug in during section 7. Do not "fix" it ahead of time.

`src/app.ts`:

```ts
import express from "express";
import { createLogger, type Logger } from "./lib/logger";
import { accessLog } from "./middleware/accessLog";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import type { TaskRepository } from "./repositories/taskRepository";
import { tasksRouter } from "./routes/tasks";
import { createTaskService } from "./services/taskService";

export interface AppDeps {
  repo: TaskRepository;
  logger?: Logger;
}

export function createApp({ repo, logger = createLogger() }: AppDeps) {
  const app = express();
  const service = createTaskService(repo);

  app.use(requestContext);       // 1. give every request an id
  app.use(accessLog(logger));    // 2. log every request when it finishes
  app.use(express.json());       // 3. parse JSON bodies

  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/tasks", tasksRouter(service));

  app.use(notFound);
  app.use(errorHandler(logger)); // must be last
  return app;
}
```

`src/server.ts`:

```ts
import { createApp } from "./app";
import { createLogger } from "./lib/logger";
import { InMemoryTaskRepository } from "./repositories/inMemoryTaskRepository";

const logger = createLogger();
const port = Number(process.env.PORT ?? 3000);

createApp({ repo: new InMemoryTaskRepository(), logger }).listen(port, () => {
  logger.info({ port }, "server listening");
});
```

Test helpers, `tests/helpers/buildTestApp.ts`:

```ts
import { createApp } from "../../src/app";
import { createLogger } from "../../src/lib/logger";
import { InMemoryTaskRepository } from "../../src/repositories/inMemoryTaskRepository";
import type { TaskRepository } from "../../src/repositories/taskRepository";

export function buildTestApp(overrides: { repo?: TaskRepository } = {}) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ write: (chunk) => { lines.push(JSON.parse(chunk)); } }, "debug");
  const app = createApp({ repo: overrides.repo ?? new InMemoryTaskRepository(), logger });
  return { app, lines };
}
```

`tests/integration/tasks.api.test.ts`:

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { TaskRepository } from "../../src/repositories/taskRepository";
import { buildTestApp } from "../helpers/buildTestApp";

describe("POST /tasks", () => {
  let ctx: ReturnType<typeof buildTestApp>;
  beforeEach(() => { ctx = buildTestApp(); }); // fresh app and data for every test

  it("creates a task and returns 201", async () => {
    const res = await request(ctx.app).post("/tasks").send({ title: " Ship it " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Ship it", done: false, workspace: "default" });
    expect(res.body.id).toEqual(expect.any(String));
  });

  it("returns 400 with the standard error shape for an empty title", async () => {
    const res = await request(ctx.app).post("/tasks").send({ title: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 409 for a duplicate open title", async () => {
    await request(ctx.app).post("/tasks").send({ title: "Same" });
    const res = await request(ctx.app).post("/tasks").send({ title: "same" });
    expect(res.status).toBe(409);
  });

  it("returns 400 INVALID_JSON for malformed JSON", async () => {
    const res = await request(ctx.app).post("/tasks").set("content-type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("keeps workspaces separate", async () => {
    await request(ctx.app).post("/tasks").set("x-workspace", "a").send({ title: "Only in A" });
    const res = await request(ctx.app).get("/tasks").set("x-workspace", "b");
    expect(res.body).toEqual([]);
  });
});

describe("failure handling", () => {
  it("returns a safe 500 and logs the real error when the repository fails", async () => {
    const boom = () => { throw new Error("db password is hunter2"); };
    const failingRepo: TaskRepository = { insert: boom, findById: boom, list: boom, update: boom };
    const { app, lines } = buildTestApp({ repo: failingRepo });

    const res = await request(app).post("/tasks").send({ title: "x" });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("hunter2"); // nothing internal leaks
    const errorLine = lines.find((l) => l.level === 50);       // pino: 50 = error
    expect(errorLine?.requestId).toBe(res.headers["x-request-id"]);
  });

  it("returns 404 JSON for unknown routes", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
```

Commentary: `buildTestApp()` in `beforeEach` gives each test its own repo, so tests cannot affect each other. The failing-repo test is only possible because the repo is injected. The `boom` stubs are synchronous throws; Express 5 turns them into error-middleware calls just like rejections.

**Common beginner mistakes.**
- *Sharing one `app`/repo at module level.* *Symptom:* tests pass alone but fail together, or pass/fail depending on order. *Fix:* build state in `beforeEach`.
- *Calling `request(app.listen(3000))`.* *Symptom:* `EADDRINUSE` or Vitest hangs after finishing. *Fix:* pass the `app` itself.
- *Asserting a whole body with `toEqual` when it has generated fields.* *Fix:* `toMatchObject` plus `expect.any(String)`.

**Try it (5 min).** Add an API test for `POST /tasks/:id/complete` for an unknown id (expect 404 and `error.code === "NOT_FOUND"`), then one for the happy path.

---

### Section 4: Playwright end-to-end tests and fixtures (20 min)

**Explanation.** **Playwright** is a test runner that can drive browsers *and* make raw HTTP calls. For a backend service, an **e2e API test** starts your server as a separate process (like production) and talks to it over a real port. A **fixture** is a reusable, automatically set-up-and-torn-down resource handed to each test as an argument.

**Why it matters.** Integration tests run the app in the test process. E2E tests catch what only shows up when it is a real server: wrong port config, startup crashes, middleware order that differs, env vars, and headers over real HTTP.

**Mental model.** Fixtures are like `beforeEach` that *returns a value* and cleans up after itself, similar to a custom React hook but for tests (if learners know hooks) or to a factory function with a `finally` block.

**Code example.**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry", // a full recording of the failed run, saved only when needed
  },
  webServer: {
    command: "npx tsx src/server.ts",
    url: `http://localhost:${PORT}/health`, // Playwright waits for this to return 2xx
    env: { PORT: String(PORT), LOG_LEVEL: "warn" },
    reuseExistingServer: !process.env.CI,
  },
});
```

`e2e/fixtures.ts`:

```ts
import { randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext } from "@playwright/test";

type Fixtures = {
  workspace: string;
  api: APIRequestContext;
};

export const test = base.extend<Fixtures>({
  // A brand-new workspace name per test = private data per test.
  workspace: async ({}, use) => {
    await use(`e2e-${randomUUID()}`);
  },
  // An HTTP client that automatically sends that workspace header.
  api: async ({ playwright, baseURL, workspace }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-workspace": workspace },
    });
    await use(ctx);       // the test runs here
    await ctx.dispose();  // teardown always runs
  },
});

export { expect };
```

`e2e/tasks.spec.ts`:

```ts
import { expect, test } from "./fixtures";

test("create → complete → list journey", async ({ api }) => {
  const created = await api.post("/tasks", { data: { title: "  Write e2e tests " } });
  expect(created.status()).toBe(201);
  const task = await created.json();
  expect(task).toMatchObject({ title: "Write e2e tests", done: false });

  const completed = await api.post(`/tasks/${task.id}/complete`);
  expect(completed.ok()).toBeTruthy();

  const list = await (await api.get("/tasks")).json();
  expect(list).toEqual([expect.objectContaining({ id: task.id, done: true })]);
});
```

Line-by-line: the final `toEqual([ ... ])` asserts there is **exactly one** task. That only works because this test owns its workspace; it is the proof of isolation. `await use(...)` splits setup from teardown.

Run: `npm run test:e2e`. Open the report with `npx playwright show-report`.

**Common beginner mistakes.**
- *Symptom:* `Error: Timed out waiting for the webServer` or `http://localhost:3100/health is already used`. *Fix:* check `PORT` is read by `server.ts`; stop any stray server on that port; confirm the `url` returns 2xx.
- *Forgetting `await` on `.json()`* gives a Promise instead of an object (`expect(received).toMatchObject` fails oddly). *Fix:* `await`.
- *Importing `test` from `@playwright/test` instead of `./fixtures`.* *Symptom:* `api`/`workspace` are "not a known fixture". *Fix:* import from your fixtures file.

**Try it (5 min).** Run the journey test. Then change `"x-workspace"` handling temporarily (comment out `extraHTTPHeaders`), run it twice, and watch what shared data does. Put it back.

**Stretch (optional, browser):** add `public/index.html`, serve it with `express.static`, and use `test("...", async ({ page }) => { await page.goto("/"); ... })`. Needs `npx playwright install chromium`. Everything else (fixtures, isolation, traces) is unchanged.

---

### Section 5: Isolated data and critical failure paths (15 min)

**Explanation.** **Isolated data** means no test can read, change or depend on another test's data. **Critical failure paths** are the "unhappy" journeys that cost real money or trust if they break: invalid input, duplicates, missing records, malformed requests, and safe server errors.

**Why it matters.** Tests that share data fail randomly when run in parallel ("flaky tests"), and teams start ignoring red builds. Happy-path-only suites miss exactly the situations that cause incidents.

**Mental model.** Like giving each test its own browser incognito window: same website, separate storage. Our `x-workspace` header is the incognito window.

**Code example.** Append to `e2e/tasks.spec.ts`:

```ts
test.describe("isolation", () => {
  // Same title in two tests running in parallel: would collide if data were shared.
  test("test A can use 'Same title'", async ({ api }) => {
    expect((await api.post("/tasks", { data: { title: "Same title" } })).status()).toBe(201);
  });
  test("test B can also use 'Same title'", async ({ api }) => {
    expect((await api.post("/tasks", { data: { title: "Same title" } })).status()).toBe(201);
  });

  test("another workspace cannot see or complete my task", async ({ api, playwright, baseURL }) => {
    const mine = await (await api.post("/tasks", { data: { title: "Private" } })).json();

    const other = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-workspace": "someone-else" },
    });
    expect(await (await other.get("/tasks")).json()).not.toContainEqual(expect.objectContaining({ id: mine.id }));
    expect((await other.post(`/tasks/${mine.id}/complete`)).status()).toBe(404);
    await other.dispose();
  });
});

test.describe("critical failure paths", () => {
  test("rejects an empty title with 400 and a request id", async ({ api }) => {
    const res = await api.post("/tasks", { data: { title: "   " } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBe(res.headers()["x-request-id"]);
  });

  test("rejects a duplicate open title with 409", async ({ api }) => {
    await api.post("/tasks", { data: { title: "Pay rent" } });
    const res = await api.post("/tasks", { data: { title: "pay rent" } });
    expect(res.status()).toBe(409);
  });

  test("rejects malformed JSON with 400, not 500", async ({ api }) => {
    const res = await api.post("/tasks", { data: "{oops", headers: { "content-type": "application/json" } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });

  test("returns 404 for an unknown task id", async ({ api }) => {
    expect((await api.post("/tasks/does-not-exist/complete")).status()).toBe(404);
  });

  test("rejects an invalid workspace header", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-workspace": "bad workspace!" } });
    expect((await ctx.get("/tasks")).status()).toBe(400);
    await ctx.dispose();
  });

  test("echoes a caller-supplied request id", async ({ api }) => {
    const res = await api.get("/tasks", { headers: { "x-request-id": "trace-me-12345" } });
    expect(res.headers()["x-request-id"]).toBe("trace-me-12345");
  });
});
```

Commentary: a 500 cannot be triggered safely against the real server without a test-only hook, so that path is covered in the integration test with a failing repo (section 3). Choosing the **cheapest layer that can prove each behaviour** is a core skill; say it out loud.

**Common beginner mistakes.**
- *Cleaning up by deleting data at the end of each test.* *Symptom:* a failed test skips cleanup and poisons later runs. *Fix:* isolate (unique workspace/ids) instead of cleaning.
- *Hard-coded ids/emails shared across tests.* *Symptom:* passes with `--workers=1`, fails in parallel. *Fix:* generate unique values in fixtures.
- *Asserting only the status code on failure paths.* *Fix:* also assert the error `code` and shape, because that is the contract clients rely on.

**Try it (5 min).** Run with `npx playwright test --workers=4 --repeat-each=5`. If anything fails intermittently, find the shared state.

---

### Section 6: Request tracing and structured logs (30 min)

**Explanation.** A **structured log** is a log line that is machine-readable JSON (`{"level":30,"msg":"request completed","status":201,...}`) instead of free text, so you can filter and aggregate it. **Request tracing** (at the simplest level) means giving each request a unique **request ID** and putting it on every log line and in the response, so you can follow one request through the whole system. **AsyncLocalStorage** (ALS) is Node's built-in "context that follows async calls", so you do not pass the ID through every function.

**Why it matters.** When a user reports "it failed at 10:42", the request ID in their error response lets you pull exactly the logs for that request and skip the thousands of others.

**Mental model.** Like a package tracking number: attach it at the door (`requestContext` middleware), and every scan along the way (log line) carries it. In the browser world, it is the network panel row you click on to see one request's details.

**Code example.** The pieces are already in place from section 3: `requestContext.ts` (ID creation and ALS), `logger.ts` (the `mixin` that stamps the ID), `accessLog.ts` (one summary line per request), and `errorHandler.ts` (logs unexpected errors with the ID).

Any code that uses the shared `logger` gets the `requestId` automatically through the `mixin`, with no need to pass the ID around or attach a logger to `req`. To log a business event, pass the logger in where needed and log an event name plus fields, for example `logger.info({ taskId: task.id }, "task created")`.

A test that proves tracing works, `tests/integration/tracing.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/buildTestApp";

describe("request tracing", () => {
  it("generates a request id, returns it, and stamps it on the access log", async () => {
    const { app, lines } = buildTestApp();
    const res = await request(app).post("/tasks").send({ title: "trace me" });

    const id = res.headers["x-request-id"];
    expect(id).toMatch(/^[\w-]{8,64}$/);

    const access = lines.find((l) => l.msg === "request completed");
    expect(access).toMatchObject({ requestId: id, method: "POST", route: "/tasks/", status: 201 });
    expect(access?.durationMs).toEqual(expect.any(Number));
  });

  it("keeps ids separate for concurrent requests", async () => {
    const { app, lines } = buildTestApp();
    const [a, b] = await Promise.all([
      request(app).get("/tasks").set("x-request-id", "request-a-0001"),
      request(app).get("/tasks").set("x-request-id", "request-b-0002"),
    ]);
    expect(a.headers["x-request-id"]).toBe("request-a-0001");
    expect(b.headers["x-request-id"]).toBe("request-b-0002");
    const ids = lines.filter((l) => l.msg === "request completed").map((l) => l.requestId);
    expect(ids.sort()).toEqual(["request-a-0001", "request-b-0002"]);
  });
});
```

Reading logs while developing:

```bash
npm i -D pino-pretty
npx tsx src/server.ts | npx pino-pretty
```

Following one request in production-style JSON logs (`jq` is a JSON filter):

```bash
npx tsx src/server.ts | jq 'select(.requestId=="trace-me-12345")'
```

Logging rules to teach: use levels deliberately (`error` = a human should look; `warn` = suspicious; `info` = normal events; `debug` = noisy detail); log **events with fields** (`logger.info({ taskId }, "task completed")`) not sentences with values glued in; **never log secrets**, passwords, tokens or full request bodies; keep route labels low-cardinality (`/tasks/:id/complete`, not the raw URL).

> **Version note:** `AsyncLocalStorage.bind` and the pino `mixin` option should be confirmed against current Node and pino docs. The concurrency test above will fail loudly if context is lost.

**Common beginner mistakes.**
- *Symptom:* `requestId` missing on some log lines (for example, the access log). *Cause:* context lost across event-emitter callbacks. *Fix:* bind the callback (`AsyncLocalStorage.bind`) as in `accessLog`.
- *Logging `console.log("user", user)`.* *Symptom:* unsearchable, unstructured output, possible personal data in logs. *Fix:* structured logger with selected fields.
- *Returning `err.message` or the stack to clients.* *Symptom:* internal details visible in API responses. *Fix:* the generic 500 body plus a logged error with the request ID.
- *Setting the log level via code edits.* *Fix:* `LOG_LEVEL` env var (already supported).

**Try it (5 min).** In `errorHandler`, temporarily make the `POST /tasks` route throw `new Error("test")`, call it with curl, copy the `x-request-id` from the response, and find the matching error line in the server output.

---

### Section 7: Debugging and regression checks (13 min)

**Explanation.** **Debugging** is reproducing, isolating and fixing a fault. A **regression** is something that used to work and broke; a **regression test** is a test that fails because of that exact bug and stays in the suite forever so it cannot return silently. A **regression check** is the automated gate (`npm run check`, CI) that runs all tests before code is merged.

**Why it matters.** Without a regression test, you fix a bug once and discover it again in six months.

**Mental model.** Like a browser bug report: reproduce in DevTools, find the cause, fix, and then add a test so it cannot sneak back.

**The scenario.** Support reports: *"POST /tasks without a body returns a 500."* Walk the loop:

1. **Reproduce from the report**, and use the request ID from their response to find the log line:

```bash
curl -i -X POST http://localhost:3000/tasks
```

   The log shows `unhandled error` with `TypeError: Cannot read properties of undefined (reading 'title')`. A 500 for a client mistake is the bug; it should be a 400.

2. **Write the failing test first** (`tests/integration/tasks.api.test.ts`):

```ts
it("returns 400 (not 500) when the request has no body", async () => {
  const res = await request(ctx.app).post("/tasks"); // no body, no content-type
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("VALIDATION_ERROR");
});
```

   Run it: red (status 500).

3. **Fix** in `src/routes/tasks.ts`. In Express 5, `req.body` is `undefined` when no parser handled the request, so guard it:

```ts
const task = await service.create(workspaceOf(req), { title: req.body?.title });
```

   The service's `typeof` check now produces a `ValidationError` (400). Run: green.

4. **Keep the test.** Also add the same case to the e2e failure-path block if the team wants real-server coverage.

Debugging tools:

- **Breakpoints in VS Code**, `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeArgs": ["--import", "tsx"],
      "program": "${workspaceFolder}/src/server.ts",
      "console": "integratedTerminal"
    }
  ]
}
```

- **Debug one test:** open a *JavaScript Debug Terminal* in VS Code and run `npx vitest run --no-file-parallelism -t "no body"`.
- **Playwright:** `npx playwright test --ui` (time-travel UI), `npx playwright test --debug`, and for a failed CI run `npx playwright show-trace trace.zip`.

The regression gate, `.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run check
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report }
```

> **Version note:** check the current major versions of the GitHub Actions used here.

**Common beginner mistakes.**
- *Fixing before reproducing.* *Symptom:* you "fix" something, the bug is still there. *Fix:* failing test first.
- *Debugging by sprinkling `console.log` and forgetting to remove it.* *Fix:* breakpoints or structured logs at the right level.
- *`it.only` / `test.only` committed.* *Symptom:* CI is green but only one test ran. *Fix:* Playwright's `forbidOnly: !!process.env.CI` in config; review diffs.
- *Debugging a Vitest test with parallel workers.* *Symptom:* breakpoints never hit or hit randomly. *Fix:* `--no-file-parallelism` (verify the flag for your Vitest major).

**Try it (5 min).** Run the bug-hunt exactly as above. Then deliberately re-introduce the bug (`req.body.title`) and confirm the regression test catches it.

---

### Section 8: Documentation (7 min)

**Explanation.** Documentation here means what a teammate needs to run, test, call and debug the service: a README, an endpoint reference with the error format, and a short **runbook** (steps for handling a known problem).

**Why it matters.** Tests prove behaviour; logs show behaviour; docs tell people *how to use both*. The request-ID workflow only helps if the team knows it exists.

**Mental model.** Like a component's props documentation: the contract another developer relies on without reading your source.

**Code example.** `README.md` skeleton:

~~~markdown
# task-api

Multi-workspace task API (Express 5 + TypeScript).

## Run
- `npm run dev` starts the API on :3000 (set `PORT`, `LOG_LEVEL`).
- Pipe through `pino-pretty` for readable logs.

## Test
- `npm test` runs unit and integration tests (Vitest + Supertest).
- `npm run test:e2e` runs Playwright against a real server on :3100.
- `npm run check` runs typecheck + everything (the CI gate).

## API
| Method | Path                | Success    | Errors                                            |
| ------ | ------------------- | ---------- | ------------------------------------------------- |
| POST   | /tasks              | 201 task   | 400 VALIDATION_ERROR / INVALID_JSON, 409 CONFLICT |
| GET    | /tasks              | 200 task[] | 400 VALIDATION_ERROR                              |
| POST   | /tasks/:id/complete | 200 task   | 404 NOT_FOUND                                     |

Header `x-workspace` (optional) partitions data. Header `x-request-id` (optional) sets the trace id.

Every error: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`

## Runbook: "I got a 500"
1. Ask for the `requestId` from the error body (or the `x-request-id` header).
2. Filter logs: `jq 'select(.requestId=="<id>")'`.
3. Find the `unhandled error` line; reproduce it with a failing test before fixing.
4. Fix, keep the regression test, run `npm run check`.
~~~

**Common beginner mistakes.**
- *Docs that describe what the code was last month.* *Fix:* keep the endpoint table next to the tests; update both in the same PR.
- *Documenting only the happy path.* *Fix:* list the error codes clients should handle.
- *Writing "how it works" prose nobody reads.* *Fix:* commands someone can copy and run.

**Try it (3 min).** Write the runbook entry for "duplicate task returns 409 but the user says it doesn't exist" (hint: closed vs open tasks).

---

## 4. How the sub-sections connect

**Dependency chain**

```
S1 Setup + testing map
   └─► S2 Unit tests + TDD (service, fakes, DI)
          └─► S3 Integration/API tests (app factory, Supertest, failing-repo stub)
                 ├─► S4 Playwright e2e + fixtures
                 │      └─► S5 Isolated data + failure paths
                 └─► S6 Tracing + structured logs  (the logs/IDs are asserted in S3-style tests)
                        └─► S7 Debugging + regression (uses S3 tests, S5 e2e, S6 request IDs)
                               └─► S8 Documentation (captures all of the above)
```

**Hierarchy.** Layers get slower and more realistic downward in the tests (S2 → S3 → S4/S5). Observability (S6) is a cross-cutting layer that S7 and S8 depend on. DI (introduced in S2, `createApp` in S3) is the thread that makes every later section possible.

**Suggested live-teaching flow**

1. **Demo (5 min):** show the finished `npm run check` going green and one Playwright report. Show the end state before building it.
2. **Learners code:** S1 scaffold (paste the starter files; do not type them).
3. **Live-code together:** S2 cycles one at a time. Pause after every red; ask learners to predict the failure message. Learners type every cycle.
4. **Demo then learners extend:** S3. You write the first test; they write the 404 and happy-path `complete` tests.
5. **Learners code:** S4 config + fixture + journey test. Walk the room; the usual issue is the port or the fixtures import.
6. **Learners code:** S5 failure paths. Run `--repeat-each=5` as a group to feel the "parallel flake" risk.
7. **Demo, then learners code:** S6. Show the JSON logs, then pretty logs, then the `jq` filter on a request ID. Learners trigger the error and find it.
8. **Bug hunt:** S7 as a competition: who finds the cause from the log line first?
9. **Close:** S8 README + knowledge check in the last minutes.

---

## 5. Key terms glossary (order of first appearance)

- **Test**: code that runs your code and checks the result.
- **Unit test**: tests one function or service with dependencies faked.
- **Integration test**: tests several real parts together, such as routes, middleware and service.
- **API test**: an integration test focused on the HTTP contract (status, headers, JSON shape).
- **End-to-end (e2e) test**: tests the real running system from the outside.
- **Test pyramid**: guideline of many fast tests, fewer slow ones.
- **Dependency injection (DI)**: passing a dependency in (as an argument) instead of importing it directly.
- **TDD**: writing a failing test before the code that makes it pass.
- **Red-green-refactor**: fail, pass minimally, then clean up with tests green.
- **Fake**: a simple working stand-in for a real dependency.
- **Supertest**: library that sends HTTP requests directly to an Express app in memory.
- **Factory (`createApp`)**: a function that builds and returns a configured object.
- **Playwright**: test tool that can automate browsers and make HTTP calls.
- **Fixture**: reusable setup/teardown resource provided to tests.
- **Isolated data**: each test owns its data, so tests can run in parallel safely.
- **Flaky test**: a test that sometimes passes and sometimes fails without code changes.
- **Critical failure path**: an error scenario that matters to users or business.
- **Structured log**: a log line as machine-readable JSON.
- **Request ID**: unique identifier attached to one request and all its logs.
- **AsyncLocalStorage**: Node feature carrying context through async calls.
- **Regression test**: a test that guards against a previously fixed bug.
- **Runbook**: documented steps for handling a known operational problem.

---

## 6. Knowledge check

1. **Recall.** Name one bug an integration test would catch that a unit test of `TaskService` cannot, and one bug an e2e test would catch that an integration test cannot.
2. **Recall.** Why does `createApp` take the repository as a parameter instead of importing it?
3. **Predict the output.** What happens, and which error class is thrown?

```ts
const { service } = setup();
await service.create("w1", { title: "  Buy milk " });
await service.create("w1", { title: "BUY MILK" });
```

4. **Spot the bug.** This test passes even when the service is broken. Why?

```ts
it("rejects empty titles", async () => {
  const { service } = setup();
  expect(service.create("w1", { title: "" })).rejects.toBeInstanceOf(ValidationError);
});
```

5. **Spot the bug.** What two problems does this error handler have?

```ts
app.use((err, req, res, next) => {
  res.status(500).json({ message: err.message, stack: err.stack });
});
```

### Applied mini-exercise: `DELETE /tasks/:id`

**Starter.** Add `remove` to the repository interface and the in-memory repo:

```ts
// taskRepository.ts: add
remove(workspace: string, id: string): Promise<boolean>; // true if something was deleted
```

**Requirements**
- Write the unit tests **first** (TDD), then the service method, then the route.
- Returns **204 with no body** on success.
- Returns **404 `NOT_FOUND`** if the id does not exist **or belongs to another workspace**.
- Add one integration test and one Playwright test (using the `api` fixture).

**Acceptance criteria**
- `npm run check` is green.
- Deleting twice returns 204 then 404.
- A task in workspace A cannot be deleted from workspace B (tested in e2e).
- The access log for the delete request contains `route: "/tasks/:id"`, the status and the `requestId`.
- The README endpoint table is updated.

### Instructor answer key

1. Integration: wrong mount path, `express.json()` placed after routes, wrong status code (200 vs 201), error middleware not registered. E2E: server fails to start with the real entry file, `PORT` env handling is wrong, a real header or proxy behaviour differs from the in-process call.
2. So tests can pass a fake or failing repository (fast tests, forced failures such as the 500 path) and so production can swap the Map for a database without touching routes or the service.
3. The second `create` throws a `ConflictError` (HTTP 409). Trimming and case-insensitive comparison make `"Buy milk"` and `"BUY MILK"` equal among open tasks.
4. `expect(...).rejects` is not awaited, so the test finishes before the assertion settles and a failing assertion is lost (or becomes an unhandled rejection). Fix: `await expect(...).rejects.toBeInstanceOf(ValidationError)`.
5. It leaks internals (`err.message`, `stack`) to clients, and it returns 500 for every error, including client mistakes that should be 4xx. It also never logs the error and has no request ID for support to use. Fix: use `AppError` mapping, log with `logger.error`, return a generic body with `requestId`.

**Model solution to the exercise**

`taskRepository.ts` / `inMemoryTaskRepository.ts`:

```ts
// interface
remove(workspace: string, id: string): Promise<boolean>;

// in-memory implementation
async remove(workspace: string, id: string) {
  const t = this.tasks.get(id);
  if (!t || t.workspace !== workspace) return false;
  return this.tasks.delete(id);
}
```

Unit tests first (`taskService.test.ts`):

```ts
describe("TaskService.remove", () => {
  it("removes an existing task", async () => {
    const { service } = setup();
    const t = await service.create("w1", { title: "Temp" });
    await service.remove("w1", t.id);
    expect(await service.list("w1")).toEqual([]);
  });

  it("throws NotFoundError for an unknown id", async () => {
    const { service } = setup();
    await expect(service.remove("w1", "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError for another workspace's task", async () => {
    const { service } = setup();
    const t = await service.create("w1", { title: "Temp" });
    await expect(service.remove("w2", t.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

(Add `NotFoundError` to that file's imports.) Service method:

```ts
async remove(workspace: string, id: string): Promise<void> {
  const removed = await repo.remove(workspace, id);
  if (!removed) throw new NotFoundError(`task ${id} not found`);
},
```

Route:

```ts
router.delete("/:id", async (req, res) => {
  await service.remove(workspaceOf(req), req.params.id);
  res.status(204).end();
});
```

Integration test:

```ts
it("DELETE returns 204 then 404", async () => {
  const created = await request(ctx.app).post("/tasks").send({ title: "Temp" });
  expect((await request(ctx.app).delete(`/tasks/${created.body.id}`)).status).toBe(204);
  expect((await request(ctx.app).delete(`/tasks/${created.body.id}`)).status).toBe(404);
});
```

Playwright test:

```ts
test("cannot delete another workspace's task", async ({ api, playwright, baseURL }) => {
  const task = await (await api.post("/tasks", { data: { title: "Mine" } })).json();
  const other = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-workspace": "intruder" } });
  expect((await other.delete(`/tasks/${task.id}`)).status()).toBe(404);
  expect((await api.delete(`/tasks/${task.id}`)).status()).toBe(204);
  await other.dispose();
});
```

Note on the access-log criterion: `route` is built from `req.baseUrl + req.route.path`, which yields `/tasks/:id` for this route.

---

## 7. Summary recap

1. **Match the test layer to the risk:** unit for rules, integration for wiring and contract, e2e for the real running system. Use the cheapest layer that can prove the behaviour.
2. **TDD is a loop**, not a style: red, minimal green, refactor, one small step at a time.
3. **Dependency injection** (factories, injected repo, clock and ID generator) is what makes code testable, including its failure modes.
4. **Isolate data per test** (unique workspace/ids via fixtures) so suites stay parallel-safe and trustworthy.
5. **Every request gets an ID**, every log line carries it, and errors return it: that turns "it broke" into a ten-second log lookup.
6. **Every fixed bug leaves a regression test and a doc trail**, enforced by one command (`npm run check`) in CI.

---

## 8. Next lesson bridge

You can now change this API with confidence and diagnose it when something fails. The natural next step is making it production-ready: swapping the in-memory store for a real database (where your repository interface and test layers pay off), and then packaging and deploying it with configuration, builds and CI/CD. Adjust this to whatever your course covers next.