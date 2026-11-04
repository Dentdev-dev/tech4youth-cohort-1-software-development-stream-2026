# React Routing and API Integration — ProjectHub Practical Lab

**Level:** Beginner to intermediate | **Stack:** Vite, React, TypeScript, React Router v7 (data mode), Tailwind CSS v4, Express | **Duration:** 6 hours

## What you will build

**ProjectHub** is a small project management dashboard. Students will practice page navigation, nested routes, dynamic URLs, URL-based search/filter/pagination, fetching data, creating/editing/deleting projects, task tabs, loading indicators, and error handling. All examples below are **complete files** rather than fragments. The backend uses in-memory data: **restarting the API resets changes**.

### Learning sequence

1. Start an Express API and a React client.
2. Create routes, layouts, links, and nested project tabs.
3. Use URL query parameters for filters and pagination.
4. Build a typed API client.
5. First fetch using `useEffect` (a separate practice component).
6. Fetch page data using React Router loaders.
7. Use actions and `<Form>` for create, edit, and delete.
8. Handle missing projects, failed requests, and pending navigation.

## 1. Project folder structure

```text
projecthub/
├── client/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── index.css
│       ├── router.tsx
│       ├── types.ts
│       ├── loaders.ts
│       ├── actions.ts
│       ├── api/
│       │   ├── client.ts
│       │   └── projects.ts
│       ├── lib/
│       │   └── parse.ts
│       ├── layouts/
│       │   ├── RootLayout.tsx
│       │   └── ProjectLayout.tsx
│       ├── components/
│       │   └── EffectProjectsDemo.tsx
│       └── pages/
│           ├── Home.tsx
│           ├── Projects.tsx
│           ├── ProjectOverview.tsx
│           ├── TaskList.tsx
│           ├── NewProject.tsx
│           ├── EditProject.tsx
│           ├── NotFound.tsx
│           └── RouteError.tsx
└── server/
    └── src/
        └── index.ts
```

> The Vite scaffold also generates files such as `package.json`, `tsconfig.json`, and `src/vite-env.d.ts`. Keep those generated files. You can remove the starter `App.tsx` and `App.css` because this lab uses `router.tsx` as its entry point.

## 2. Set up both applications (Bash)

Run these commands from a terminal:

```bash
mkdir projecthub
cd projecthub
npm create vite@latest client -- --template react-ts
cd client
npm install
npm install react-router tailwindcss @tailwindcss/vite
cd ..
mkdir -p server/src
cd server
npm init -y
npm install express
npm install -D typescript tsx @types/express @types/node
cd ..
```

**What the commands mean:** `cd` changes directory; `mkdir -p` creates a folder and missing parents; `npm install` installs dependencies; `-D` installs development-only packages; `--template react-ts` chooses React + TypeScript.

### `client/vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://localhost:3001" },
  },
});
```

**Why:** The browser sends `/api/...` requests to Vite; Vite forwards them to Express at port 3001. This avoids development CORS issues.

### `client/src/index.css`

```css
@import "tailwindcss";

body {
  margin: 0;
  background: #f8fafc;
  color: #0f172a;
  font-family: system-ui, sans-serif;
}
button, input, select, textarea { font: inherit; }
```

## 3. Backend: Express starter API

Create **`server/src/index.ts`** and paste the following code. The API stores data in arrays, provides CRUD endpoints, and intentionally delays responses so students can observe loading states. The first project responds more slowly to demonstrate request races.

```ts
import express from "express";

type Status = "active" | "archived";
interface Project { id: number; name: string; description: string; status: Status }
interface Task { id: number; projectId: number; title: string; done: boolean }

let projects: Project[] = Array.from({ length: 12 }, (_, i): Project => ({
  id: i + 1,
  name: `Project ${i + 1}`,
  description: `Description for project ${i + 1}`,
  status: i % 3 === 0 ? "archived" : "active",
}));
const tasks: Task[] = projects.flatMap((p) =>
  [1, 2, 3].map((n) => ({ id: p.id * 10 + n, projectId: p.id, title: `Task ${n} of ${p.name}`, done: n === 1 }))
);
let nextId = 13;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const slow = /^\/api\/projects\/1(\/|$)/.test(req.path); // project 1 is slow on purpose
  setTimeout(next, slow ? 1500 : 400);
});

app.get("/api/projects", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";
  const status = req.query.status;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 5;
  const filtered = projects.filter(
    (p) => p.name.toLowerCase().includes(q) && (status === "active" || status === "archived" ? p.status === status : true)
  );
  res.json({ items: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, limit });
});

app.get("/api/projects/:id", (req, res) => {
  const project = projects.find((p) => p.id === Number(req.params.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(project);
});

app.get("/api/projects/:id/tasks", (req, res) => {
  const done = req.query.done;
  res.json(tasks.filter((t) => t.projectId === Number(req.params.id) && (done === "true" ? t.done : done === "false" ? !t.done : true)));
});

app.post("/api/projects", (req, res) => {
  const { name, description } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || name.trim().length < 3) { res.status(400).json({ error: "Name must be at least 3 characters" }); return; }
  const project: Project = { id: nextId++, name: name.trim(), description: typeof description === "string" ? description : "", status: "active" };
  projects.unshift(project);
  res.status(201).json(project);
});

app.patch("/api/projects/:id", (req, res) => {
  const project = projects.find((p) => p.id === Number(req.params.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const { name, description, status } = (req.body ?? {}) as Record<string, unknown>;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 3) { res.status(400).json({ error: "Name must be at least 3 characters" }); return; }
    project.name = name.trim();
  }
  if (typeof description === "string") project.description = description;
  if (status === "active" || status === "archived") project.status = status;
  res.json(project);
});

app.delete("/api/projects/:id", (req, res) => {
  const before = projects.length;
  projects = projects.filter((p) => p.id !== Number(req.params.id));
  if (projects.length === before) { res.status(404).json({ error: "Project not found" }); return; }
  res.status(204).end();
});

app.listen(3001, () => console.log("API on http://localhost:3001"));
```

**Available endpoints:**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/projects?q=&status=&page=` | Search/filter/paginate projects |
| GET | `/api/projects/:id` | Read one project |
| GET | `/api/projects/:id/tasks?done=true` | Read tasks, optionally filtered |
| POST | `/api/projects` | Create a project |
| PATCH | `/api/projects/:id` | Edit a project |
| DELETE | `/api/projects/:id` | Delete a project |

**Run the server in terminal 1:**

```bash
cd projecthub/server
npx tsx watch src/index.ts
```

**Test it in another Bash terminal:**

```bash
curl http://localhost:3001/api/projects
curl http://localhost:3001/api/projects/1
curl 'http://localhost:3001/api/projects?q=Project&status=active&page=1'
curl http://localhost:3001/api/projects/999
```

**Practice:** Predict which request returns `404`. Then change the search text and observe the JSON response.

## 4. Shared TypeScript types

### `client/src/types.ts`

```ts
export type ProjectStatus = "active" | "archived";

export interface Project {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  done: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface NewProjectInput {
  name: string;
  description: string;
}

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };
```

**Why:** A `Project` describes one record. `Page<Project>` describes a paginated API response. `AsyncState<T>` describes loading, error, and successful states without mixing incompatible data.

## 5. Typed API client

### `client/src/api/client.ts`

```ts
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
```

**Why:** `fetch()` does not throw for HTTP 404/500; it throws for network failures. We check `response.ok`, and handle `204 No Content` without trying to parse JSON.

### `client/src/api/projects.ts`

```ts
import { request } from "./client";
import type { NewProjectInput, Page, Project, ProjectStatus, Task } from "../types";

export interface ListParams {
  q?: string;
  status?: ProjectStatus;
  page?: number;
}

export const projectsApi = {
  list(params: ListParams = {}, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.status) query.set("status", params.status);
    if (params.page) query.set("page", String(params.page));
    const suffix = query.toString();
    return request<Page<Project>>(`/api/projects${suffix ? `?${suffix}` : ""}`, { signal });
  },

  get(id: number, signal?: AbortSignal) {
    return request<Project>(`/api/projects/${id}`, { signal });
  },

  tasks(id: number, done?: boolean, signal?: AbortSignal) {
    const suffix = done === undefined ? "" : `?done=${done}`;
    return request<Task[]>(`/api/projects/${id}/tasks${suffix}`, { signal });
  },

  create(input: NewProjectInput) {
    return request<Project>("/api/projects", {
      method: "POST", body: JSON.stringify(input),
    });
  },

  update(id: number, patch: Partial<NewProjectInput & { status: ProjectStatus }>) {
    return request<Project>(`/api/projects/${id}`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
  },

  remove(id: number) {
    return request<void>(`/api/projects/${id}`, { method: "DELETE" });
  },
};
```

**Practice:** Explain what `URLSearchParams` does when a search includes spaces or `&`. Explain why `signal` is optional.

## 6. Validate route and query parameters

### `client/src/lib/parse.ts`

```ts
import type { ProjectStatus } from "../types";

export function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Response("Project not found", { status: 404 });
  }
  return id;
}

export function parseStatus(value: string | null): ProjectStatus | undefined {
  return value === "active" || value === "archived" ? value : undefined;
}

export function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
```

**Why:** URL values are strings. `parseId` rejects invalid project IDs; `parsePage` safely defaults invalid pages to 1.

## 7. Route loaders: fetching before rendering a page

### `client/src/loaders.ts`

```ts
import type { LoaderFunctionArgs } from "react-router";
import { ApiError } from "./api/client";
import { projectsApi } from "./api/projects";
import { parseId, parsePage, parseStatus } from "./lib/parse";

export async function projectsLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return projectsApi.list({
    q: url.searchParams.get("q") ?? "",
    status: parseStatus(url.searchParams.get("status")),
    page: parsePage(url.searchParams.get("page")),
  }, request.signal);
}

export async function projectLoader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.projectId);
  try {
    return await projectsApi.get(id, request.signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Project not found", { status: 404 });
    }
    throw error;
  }
}

export async function tasksLoader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.projectId);
  const url = new URL(request.url);
  const raw = url.searchParams.get("done");
  const done = raw === "true" ? true : raw === "false" ? false : undefined;
  return projectsApi.tasks(id, done, request.signal);
}
```

**Why:** The router calls a loader when its route is visited. It provides URL parameters and an abort signal. `useLoaderData()` later reads the returned result.

## 8. Route actions: writing to the API

### `client/src/actions.ts`

```ts
import { redirect, type ActionFunctionArgs } from "react-router";
import { projectsApi } from "./api/projects";
import { parseId } from "./lib/parse";

export interface FormError { error: string }

function readFields(form: FormData) {
  return {
    name: String(form.get("name") ?? "").trim(),
    description: String(form.get("description") ?? "").trim(),
  };
}

export async function createProjectAction({ request }: ActionFunctionArgs): Promise<FormError | Response> {
  const input = readFields(await request.formData());
  if (input.name.length < 3) return { error: "Name must be at least 3 characters" };
  try {
    const project = await projectsApi.create(input);
    return redirect(`/projects/${project.id}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create project" };
  }
}

export async function updateProjectAction({ params, request }: ActionFunctionArgs): Promise<FormError | Response> {
  const id = parseId(params.projectId);
  const input = readFields(await request.formData());
  if (input.name.length < 3) return { error: "Name must be at least 3 characters" };
  try {
    await projectsApi.update(id, input);
    return redirect(`/projects/${id}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update project" };
  }
}

export async function deleteProjectAction({ params }: ActionFunctionArgs) {
  await projectsApi.remove(parseId(params.projectId));
  return redirect("/projects");
}
```

**Why:** Actions receive form submissions. After a successful mutation they redirect; the router then reloads the relevant route data. Validation errors return a message instead of navigating away.

## 9. Layouts and navigation

### `client/src/layouts/RootLayout.tsx`

```tsx
import { NavLink, Outlet, useNavigation } from "react-router";

const navStyle = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-bold text-indigo-700" : "text-slate-600 hover:text-indigo-700";

export default function RootLayout() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className={`h-1 ${busy ? "animate-pulse bg-indigo-600" : ""}`} />
      <header className="flex items-center gap-6 border-b py-4">
        <strong className="text-xl">ProjectHub</strong>
        <NavLink to="/" end className={navStyle}>Home</NavLink>
        <NavLink to="/projects" className={navStyle}>Projects</NavLink>
      </header>
      <main className="mt-6" aria-busy={busy}>
        <Outlet />
      </main>
    </div>
  );
}
```

### `client/src/layouts/ProjectLayout.tsx`

```tsx
import { NavLink, Outlet, useParams } from "react-router";

const tabStyle = ({ isActive }: { isActive: boolean }) =>
  isActive ? "border-b-2 border-indigo-600 pb-2 font-semibold" : "pb-2 text-slate-500";

export default function ProjectLayout() {
  const { projectId } = useParams();
  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">Project #{projectId}</h1>
      <nav className="flex gap-5 border-b">
        <NavLink to="." end className={tabStyle}>Overview</NavLink>
        <NavLink to="tasks" className={tabStyle}>Tasks</NavLink>
      </nav>
      <div className="mt-5"><Outlet /></div>
    </section>
  );
}
```

**Practice:** Temporarily remove `<Outlet />` from `RootLayout`. What disappears? Put it back. Then visit `/projects/1/tasks` and notice that the tabs remain while the page content changes.

## 10. Pages: complete components

### `client/src/pages/Home.tsx`

```tsx
import { Link } from "react-router";
import EffectProjectsDemo from "../components/EffectProjectsDemo";

export default function Home() {
  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-bold">Welcome to ProjectHub</h1>
      <p>Browse projects, inspect tasks, and manage your work.</p>
      <Link to="/projects" className="inline-block rounded bg-indigo-600 px-4 py-2 text-white">
        Open dashboard
      </Link>
      <EffectProjectsDemo />
    </section>
  );
}
```

### `client/src/pages/Projects.tsx`

```tsx
import { Link, useLoaderData, useSearchParams } from "react-router";
import type { projectsLoader } from "../loaders";
import { parsePage, parseStatus } from "../lib/parse";

export default function Projects() {
  const data = useLoaderData() as Awaited<ReturnType<typeof projectsLoader>>;
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const status = parseStatus(searchParams.get("status")) ?? "";
  const page = parsePage(searchParams.get("page"));
  const pages = Math.max(1, Math.ceil(data.total / data.limit));

  function setFilter(key: "q" | "status", value: string) {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      return next;
    }, { replace: key === "q" });
  }

  function goToPage(nextPage: number) {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set("page", String(nextPage));
      return next;
    });
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link to="/projects/new" className="rounded bg-indigo-600 px-4 py-2 text-white">+ New project</Link>
      </div>
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search projects" value={q}
          onChange={event => setFilter("q", event.target.value)}
          placeholder="Search projects..." className="flex-1 rounded border p-2" />
        <select aria-label="Filter status" value={status}
          onChange={event => setFilter("status", event.target.value)} className="rounded border p-2">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <p className="text-sm text-slate-600">{data.total} result(s) • Page {page} of {pages}</p>
      {data.items.length === 0 ? (
        <p>No projects match your filters.</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map(project => (
            <li key={project.id} className="rounded border bg-white p-4">
              <Link to={`/projects/${project.id}`} className="font-semibold text-indigo-700 hover:underline">
                {project.name}
              </Link>
              <p className="text-sm text-slate-500">{project.status}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <button className="rounded border px-3 py-2 disabled:opacity-40"
          disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
        <button className="rounded border px-3 py-2 disabled:opacity-40"
          disabled={page >= pages} onClick={() => goToPage(page + 1)}>Next</button>
      </div>
    </section>
  );
}
```

**Try it:** Search for `Project 1`, change the status filter, click Next, refresh, and copy the URL into another tab. The URL preserves the filter values.

### `client/src/pages/ProjectOverview.tsx`

```tsx
import { Form, Link, useLoaderData, useNavigation } from "react-router";
import type { projectLoader } from "../loaders";

export default function ProjectOverview() {
  const project = useLoaderData() as Awaited<ReturnType<typeof projectLoader>>;
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting" &&
    navigation.formAction?.endsWith(`/projects/${project.id}/delete`);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{project.name}</h2>
      <p>{project.description || "No description yet."}</p>
      <p>Status: <strong>{project.status}</strong></p>
      <div className="flex gap-3">
        <Link to="edit" className="rounded bg-indigo-600 px-4 py-2 text-white">Edit</Link>
        <Form method="post" action={`/projects/${project.id}/delete`}
          onSubmit={event => { if (!window.confirm("Delete this project?")) event.preventDefault(); }}>
          <button type="submit" disabled={deleting}
            className="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50">
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </Form>
      </div>
    </section>
  );
}
```

### `client/src/pages/TaskList.tsx`

```tsx
import { Link, useLoaderData, useSearchParams } from "react-router";
import type { tasksLoader } from "../loaders";

export default function TaskList() {
  const tasks = useLoaderData() as Awaited<ReturnType<typeof tasksLoader>>;
  const [params] = useSearchParams();
  const done = params.get("done") ?? "all";

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Project tasks</h2>
      <div className="flex gap-4 text-indigo-700">
        <Link to="?">All</Link>
        <Link to="?done=true">Completed</Link>
        <Link to="?done=false">Incomplete</Link>
      </div>
      <p className="text-sm text-slate-500">Current filter: {done}</p>
      {tasks.length === 0 ? <p>No tasks found.</p> : (
        <ul className="space-y-2">
          {tasks.map(task => (
            <li key={task.id} className="rounded border bg-white p-3">
              {task.done ? "✓" : "○"} {task.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

**Practice:** Open `/projects/2/tasks?done=true` and then `?done=false`. What changes in the API response?

### `client/src/pages/NewProject.tsx`

```tsx
import { Form, useActionData, useNavigation } from "react-router";
import type { FormError } from "../actions";

export default function NewProject() {
  const result = useActionData() as FormError | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <section className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Create a project</h1>
      <Form method="post" className="space-y-3">
        <label className="block">Name
          <input name="name" required minLength={3} className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block">Description
          <textarea name="description" rows={4} className="mt-1 w-full rounded border p-2" />
        </label>
        {result?.error && <p role="alert" className="text-red-600">{result.error}</p>}
        <button type="submit" disabled={submitting}
          className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">
          {submitting ? "Creating..." : "Create project"}
        </button>
      </Form>
    </section>
  );
}
```

**Practice:** Try submitting a short name. The browser's `minLength` prevents normal submission; for the server/action validation demonstration, temporarily remove `minLength` and `required`, submit `AB`, and observe the returned error. Restore the attributes afterward.

### `client/src/pages/EditProject.tsx`

```tsx
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { FormError } from "../actions";
import type { projectLoader } from "../loaders";

export default function EditProject() {
  const project = useLoaderData() as Awaited<ReturnType<typeof projectLoader>>;
  const result = useActionData() as FormError | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <section className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Edit {project.name}</h1>
      <Form method="post" className="space-y-3">
        <label className="block">Name
          <input name="name" required minLength={3} defaultValue={project.name}
            className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block">Description
          <textarea name="description" rows={4} defaultValue={project.description}
            className="mt-1 w-full rounded border p-2" />
        </label>
        {result?.error && <p role="alert" className="text-red-600">{result.error}</p>}
        <button type="submit" disabled={submitting}
          className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">
          {submitting ? "Saving..." : "Save changes"}
        </button>
      </Form>
    </section>
  );
}
```

### `client/src/pages/NotFound.tsx`

```tsx
import { Link } from "react-router";

export default function NotFound() {
  return (
    <section>
      <h1 className="text-2xl font-bold">404 — Page not found</h1>
      <p>The requested page does not exist.</p>
      <Link to="/" className="text-indigo-700 underline">Back home</Link>
    </section>
  );
}
```

### `client/src/pages/RouteError.tsx`

```tsx
import { isRouteErrorResponse, Link, useRouteError } from "react-router";

export default function RouteError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : undefined;
  const message = isRouteErrorResponse(error)
    ? (status === 404 ? "Project not found." : error.statusText)
    : (error instanceof Error ? error.message : "Unknown error");

  return (
    <section role="alert" className="space-y-3">
      <h1 className="text-2xl font-bold">{status === 404 ? "Not found" : "Something went wrong"}</h1>
      <p>{message}</p>
      <Link to="/projects" className="text-indigo-700 underline">Back to projects</Link>
    </section>
  );
}
```

## 11. Compare `useEffect` with loaders

The dashboard above uses **loaders** for route-level data. This separate, fully working component on the Home page uses **`useEffect` + `useState`** to retrieve a small preview. This allows students to compare both patterns in one running app without two competing implementations of the same route.

### `client/src/components/EffectProjectsDemo.tsx`

```tsx
import { useEffect, useState } from "react";
import { projectsApi } from "../api/projects";
import type { AsyncState, Page, Project } from "../types";

export default function EffectProjectsDemo() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<AsyncState<Page<Project>>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    projectsApi.list({ q: query }, controller.signal)
      .then(data => setState({ status: "success", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Request failed" });
      });
    return () => controller.abort();
  }, [query]);

  return (
    <div className="rounded border bg-white p-4">
      <h2 className="mb-2 font-bold">Effect demo: API-powered preview</h2>
      <input aria-label="Preview search" value={query}
        onChange={event => { setState({ status: "loading" }); setQuery(event.target.value); }}
        placeholder="Search preview..." className="w-full rounded border p-2" />
      {state.status === "loading" && <p>Loading preview...</p>}
      {state.status === "error" && <p role="alert">{state.message}</p>}
      {state.status === "success" && (
        <ul className="mt-3 list-inside list-disc">
          {state.data.items.map(project => <li key={project.id}>{project.name}</li>)}
        </ul>
      )}
    </div>
  );
}
```

**Experiment:** Type quickly in the preview input. The cleanup aborts older requests so late responses do not overwrite newer results. React Strict Mode may issue extra development-only effect requests; this is expected.

**Compare:**

| Question | `useEffect` | Loader |
|---|---|---|
| Where is data fetched? | Component | Route function |
| Who manages loading state? | Component | Router navigation state |
| Who cancels stale requests? | `AbortController` cleanup | Router's `request.signal` |
| Best fit in this lab | Home-page preview widget | Projects, overview, tasks |

## 12. Connect all pages with the router

### `client/src/router.tsx`

```tsx
import { createBrowserRouter } from "react-router";
import RootLayout from "./layouts/RootLayout";
import ProjectLayout from "./layouts/ProjectLayout";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import ProjectOverview from "./pages/ProjectOverview";
import TaskList from "./pages/TaskList";
import NewProject from "./pages/NewProject";
import EditProject from "./pages/EditProject";
import NotFound from "./pages/NotFound";
import RouteError from "./pages/RouteError";
import { projectsLoader, projectLoader, tasksLoader } from "./loaders";
import { createProjectAction, updateProjectAction, deleteProjectAction } from "./actions";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      {
        path: "projects",
        children: [
          { index: true, element: <Projects />, loader: projectsLoader },
          { path: "new", element: <NewProject />, action: createProjectAction },
          {
            path: ":projectId",
            element: <ProjectLayout />,
            errorElement: <RouteError />,
            children: [
              { index: true, element: <ProjectOverview />, loader: projectLoader },
              { path: "tasks", element: <TaskList />, loader: tasksLoader },
              { path: "edit", element: <EditProject />, loader: projectLoader, action: updateProjectAction },
              { path: "delete", action: deleteProjectAction },
            ],
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
```

**Important:** A static route such as `projects/new` is preferred over the dynamic `projects/:projectId`. `<Outlet />` displays the matched child route.

### `client/src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "./router";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
```

## 13. Run and test the finished app

**Terminal 1 (API):**

```bash
cd projecthub/server
npx tsx watch src/index.ts
```

**Terminal 2 (React):**

```bash
cd projecthub/client
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`). Verify:

| Visit or action | Expected behavior |
|---|---|
| `/` | Home page and effect-based preview |
| `/projects` | Paginated project list |
| `/projects?q=Project+1` | Search results matching query |
| `/projects?status=archived` | Archived projects only |
| `/projects/2` | Project 2 overview |
| `/projects/2/tasks` | Task list |
| `/projects/2/tasks?done=false` | Incomplete tasks only |
| `/projects/new` | Create form; valid submit redirects to new project |
| `/projects/2/edit` | Edit form; save returns to overview |
| Delete a project | Confirmation then redirect to refreshed list |
| `/projects/abc` or `/projects/999` | Route error: project not found |
| `/this-route-does-not-exist` | Catch-all 404 page |
| Stop API and visit `/projects` | Error UI, not a blank page |

**Build check:**

```bash
cd projecthub/client
npm run build
npm run preview
```

For deployment, configure your static host to serve `index.html` for client-side paths (SPA fallback), and configure the API origin if it differs from the frontend. `VITE_API_URL` is a **public build-time** variable, not a place for secrets.

## 14. Student exercises (complete these independently)

### Exercise A — Navigation (easy, 10 minutes)

Add a new `About.tsx` page with a heading and paragraph. Add its route to `router.tsx` and its `NavLink` to `RootLayout.tsx`. Confirm that navigation does not reload the page.

**Success criteria:** `/about` renders within the same header; the active nav item changes correctly.

### Exercise B — Query strings (easy, 15 minutes)

Add a **Reset filters** button on `Projects.tsx` that clears `q`, `status`, and `page` from the URL using `setSearchParams(new URLSearchParams())`.

**Success criteria:** the input clears, the list resets, and the URL is `/projects`.

### Exercise C — API response handling (medium, 15 minutes)

Temporarily stop the Express server. Refresh `/projects`, inspect the error UI, then restart Express and reload. Explain why `fetch()` throws for a connection failure but not for a `404` response.

**Success criteria:** students can distinguish network errors from HTTP errors.

### Exercise D — Task filters (medium, 20 minutes)

Improve `TaskList.tsx` so **All**, **Completed**, and **Incomplete** show an active style based on `params.get("done")`. Use the query string, not extra component state.

**Success criteria:** the selected filter is highlighted, and refreshing preserves it.

### Exercise E — Project status editing (challenge, 25 minutes)

Extend `EditProject.tsx` with a `<select name="status">` containing `active` and `archived`. Update `updateProjectAction` to read and validate the field, then include it in `projectsApi.update`.

**Success criteria:** changing status persists in the running API and appears in filtered project lists.

### Exercise F — Programmatic navigation (challenge, 10 minutes)

Add a **Back to projects** button on the project overview that calls `useNavigate()` from an `onClick` handler. Compare it with using `<Link to="/projects">` and explain why links are preferable for ordinary navigation.

## 15. Debugging checklist

- **Blank page below navigation:** Did you add `<Outlet />`?
- **`useLoaderData()` is undefined:** Is the `loader` attached to the correct route and returning data?
- **`/api` returns HTML:** Is Express running? Did you configure the Vite proxy and restart Vite?
- **`404` does not show as an error:** Did the API client check `response.ok`?
- **Form fields are empty in the action:** Did inputs have `name` attributes?
- **Editing a project fails:** Does the route have both `loader` and `action`?
- **Page number behaves strangely:** Did you parse and validate query parameters?
- **Refreshing a deployed nested URL gives a host 404:** Configure SPA fallback to `index.html`.
- **TypeScript complains about types in imports:** Use `import type` for type-only imports.
- **Two requests appear in development:** React Strict Mode can intentionally re-run effects; ensure cleanup handles this.

## 16. Review questions

1. What is the difference between `Link` and a normal `<a>` tag in a React SPA?
2. Why does a nested layout need `<Outlet />`?
3. What value does `useParams()` return for `/projects/3`?
4. Why is the query string useful for filters?
5. What does `AbortController` prevent?
6. Why do we check `response.ok` after `fetch()`?
7. How does a loader differ from `useEffect` fetching?
8. What does a React Router action do after a form submission?
9. What is the difference between a catch-all `*` route and a thrown `404`?
10. Why do project changes disappear when Express restarts?

**Final assignment:** Extend ProjectHub with status editing, an About page, a reset-filters button, and active task-filter links. Submit a screenshot of each feature and the project folder (excluding `node_modules`).
