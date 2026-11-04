# Routing and API Integration in React

**Session length:** 6 hours, project-based
**Prior lessons covered:** Components, `useState`, `useEffect` (plus Tailwind CSS, TypeScript, and Express API route creation as stated in the brief)
**Stack:** Vite + React + TypeScript (`react-ts` template), React Router (data router), Tailwind CSS, and a small Express API
**Project thread:** **ProjectHub**, a projects dashboard with a searchable list, detail pages with tabs, and create/edit/delete, all driven by the URL and a real API

> **Assumptions.**
> 1. Learners have finished the three prior lessons, so `useState`, `useEffect` (with cleanup), and typed props are used without re-teaching. They already know how to build Express routes (verbs, status codes, JSON), so the API is provided as a **starter** they only need to read and run.
> 2. Routing uses **React Router v7** in **data mode** (`createBrowserRouter` + `RouterProvider`), because loaders and actions are where routing and API integration meet. The older `<BrowserRouter>` style is mentioned once for recognition.
> 3. API integration is taught **twice on purpose**: first with `useEffect` + `fetch` (what learners already know, and what many codebases still use), then with **loaders and actions** (the router-native way). Comparing them is the core insight of the day.
> 4. `.map()` with `key` and conditional rendering (early return, ternary, `&&`) appear in examples. Each gets a one-line placeholder: **Lists and Keys** and **Conditional Rendering** are their own lessons.
>
> **Not covered here (later lessons):** authentication and protected routes (Authentication), Context, custom hooks, TanStack Query and other data-fetching libraries, `Suspense` and React 19's `use`, route-level code splitting with `lazy` (Performance Optimization), and React Router **framework mode** (a different, full-stack setup). Each is named once where it naturally comes up.

---

## 1. Learning Objectives

By the end of this session, learners will be able to:

1. **Build** a nested route tree (layout routes, index routes, dynamic segments, a catch-all 404) and **navigate** with `Link`, `NavLink`, and `useNavigate`.
2. **Explain and implement** the URL as application state using route params (`useParams`) and search params (`useSearchParams`).
3. **Integrate** an API with a typed client module and `useEffect`, including loading and error states and a race-safe `AbortController`.
4. **Refactor** the same screens to **loaders and actions**, with pending UI, automatic revalidation after mutations, and validation errors shown from `useActionData`.
5. **Debug** the common failures (full-page reloads, string-versus-number params, stale or racing requests, a missing `<Outlet />`, `fetch` not rejecting on 404, and a 404 on refresh after deployment).

---

## 2. Prerequisite Check

Learners must already be able to:

- Build typed function components with props and manage state with `useState<T>()`.
- Use `useEffect` with a dependency array and a **cleanup function**.
- Use `async/await`, `fetch`, and JSON, and read HTTP status codes.
- Create Express routes (`GET/POST/PATCH/DELETE`) and return JSON with status codes.
- Read TypeScript unions and generics at a basic level, and use Tailwind utility classes.

**Where this fits:** This lesson comes after `useEffect` and before authentication, Context, custom hooks, and data-fetching libraries. It turns single-screen components into a multi-page application backed by a real API.

---

## 3. Section Breakdown

### 3.1 Why Routing? Single-Page Apps and the URL

**Explanation**
A traditional website loads a new HTML page from the server for every URL. A **single-page application (SPA)** loads **one** HTML page and JavaScript, then changes what's on screen as the URL changes, without a full reload. **Client-side routing** is the code that watches the URL and decides which component to show. It relies on the browser's **History API** (`history.pushState`, and the `popstate` event for back/forward buttons) to change the address bar without asking the server for a new page.

A **route** is a rule that maps a URL pattern (`/projects/:projectId`) to a component. A **router** is the library that matches the current URL against your routes and renders the winner.

**Why it matters**
Real apps have many screens, and users expect working back/forward buttons, bookmarkable and shareable links, and a refresh that keeps them where they were. A router is what provides all of that.

**Mental model**
In vanilla JS you could build a tiny router yourself. React Router automates exactly this:

```ts
// Vanilla JS "router": what React Router does for you
const routes: Record<string, string> = { "/": "<h1>Home</h1>", "/projects": "<h1>Projects</h1>" };
const app = document.getElementById("app")!;

function render() {
  app.innerHTML = routes[location.pathname] ?? "<h1>404</h1>";
}

document.addEventListener("click", (e) => {
  const link = (e.target as HTMLElement).closest("a[data-link]");
  if (!link) return;
  e.preventDefault();                                   // stop the full page load
  history.pushState({}, "", link.getAttribute("href")); // change the URL only
  render();
});

window.addEventListener("popstate", render);           // back/forward buttons
```

Line by line:
- Clicking an `<a data-link>` is intercepted, and `pushState` updates the address bar without a request to the server.
- `popstate` fires on back/forward, so we re-render for the new `location.pathname`.
- Everything else (nested layouts, params, loading data) is what a router library adds.

**Common beginner mistakes**
- **Mistake:** Expecting the server to know your SPA routes.
  **Symptom:** In production, refreshing `/projects/3` gives a **404 from the host**, while the dev server works fine.
  **Fix:** A static host must serve `index.html` for unknown paths (**SPA fallback**), covered in 3.11. Vite's dev server does this for you.
- **Mistake:** Using plain `<a href="/projects">` for in-app navigation.
  **Symptom:** The whole page reloads and all React state is lost (covered in 3.3).
  **Fix:** Use the router's `Link`.
- **Mistake:** Thinking the URL is "just decoration."
  **Symptom:** Filters and selected items vanish on refresh or can't be shared.
  **Fix:** Keep shareable state in the URL (3.5).

**Try it (3 min)**
Paste the vanilla router into a scratch HTML page with two `<a data-link href="/…">` links, click between them, and watch the address bar change with no reload (Network tab stays quiet).

---

### 3.2 Project Setup: ProjectHub and the Starter API

**Explanation**
We scaffold the client, install the router, and run a tiny in-memory Express API. The API adds **artificial latency** so loading states are visible, and **project 1 is deliberately slow** so we can provoke a race condition in 3.7. Because learners already know Express, read the starter together and then run it.

```bash
# in a project folder named projecthub/
npm create vite@latest client -- --template react-ts
cd client
npm install
npm install react-router tailwindcss @tailwindcss/vite
cd ..
mkdir server && cd server
npm init -y
npm install express
npm install -D typescript tsx @types/express @types/node
```

> **Version note:** React Router v7 ships as the **`react-router`** package. In v7 the `RouterProvider` for the DOM is imported from **`react-router/dom`**, and the older **`react-router-dom`** package still exists and re-exports the same APIs. Imports changed between v6 and v7, so check the current React Router docs. The Tailwind v4 setup is the `@tailwindcss/vite` plugin plus `@import "tailwindcss";` in `src/index.css`. In **Express 5**, `req.body` is `undefined` when no body is sent, and errors thrown in handlers are forwarded automatically. With current `@types/express` typings, route handlers should not `return res.json(…)` (they are typed to return nothing), so the code below calls `res…json(…); return;` instead.

```ts
// server/src/index.ts
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

```ts
// client/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://localhost:3001" } },
});
```

```bash
# terminal 1
cd server && npx tsx watch src/index.ts
# terminal 2
cd client && npm run dev
# quick check
curl http://localhost:3001/api/projects
```

Line by line:
- The latency middleware delays every response (400 ms; project 1 takes 1,500 ms) so spinners and races are visible. Real APIs are slower than `localhost`.
- `GET /api/projects` supports `q`, `status`, and `page` query params and returns `{ items, total, page, limit }`, which is the shape of a paginated list.
- Validation lives on the server (name of 3+ characters) so we can show server errors in the UI later.
- The Vite **proxy** forwards `/api/*` to Express so the browser sees a single origin and there are no CORS errors in development.

**Why it matters**
A fast, reliable local API with realistic delays and errors is how you test loading and error UI honestly.

**Mental model**
The server is the "database" for today. React never reaches into it directly. It only makes HTTP requests, just like any other client.

**Common beginner mistakes**
- **Mistake:** Forgetting to run the API (or running it on a different port).
  **Symptom:** `Failed to fetch`, or the proxy logs `ECONNREFUSED`.
  **Fix:** Start both terminals; confirm with `curl`.
- **Mistake:** Editing `vite.config.ts` without restarting the dev server.
  **Symptom:** The proxy seems ignored and `/api/...` returns the HTML page.
  **Fix:** Restart `npm run dev`.
- **Mistake:** Importing from `react-router-dom` in some files and `react-router` in others.
  **Symptom:** Duplicate-context errors or "useX may be used only in the context of a Router" messages.
  **Fix:** Pick one package (this lesson uses `react-router`) and stay consistent.

**Try it (3 min)**
Run `curl http://localhost:3001/api/projects/999` and `curl "http://localhost:3001/api/projects?q=project 1&status=active"`. Predict each result first.

**Project step: Milestone 1 (about 20 min)**
Scaffold both projects, paste the server, run both terminals, and confirm the curl responses.

---

### 3.3 Routes, Links, and Layouts

**Explanation**
In data mode you describe **all routes as an array of objects** and pass the result to `RouterProvider`. A route has a `path` and an `element`. Routes can be **nested**: a **layout route** renders shared UI (a navbar) and an **`<Outlet />`**, the placeholder where the matching child route renders. An **index route** (`index: true`) is the child shown at the parent's exact URL.

Navigation uses **`<Link to="…">`**, which changes the URL without a page reload, and **`<NavLink>`**, a `Link` that knows when it's *active* (so you can highlight the current page).

```tsx
// src/main.tsx
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

```tsx
// src/router.tsx
import { createBrowserRouter } from "react-router";
import RootLayout from "./layouts/RootLayout";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import NotFound from "./pages/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "projects", element: <Projects /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
```

```tsx
// src/layouts/RootLayout.tsx
import { NavLink, Outlet } from "react-router";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-bold text-indigo-600" : "text-slate-600 hover:text-slate-900";

export default function RootLayout() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="flex gap-4 border-b pb-3">
        <NavLink to="/" end className={linkClass}>Home</NavLink>
        <NavLink to="/projects" className={linkClass}>Projects</NavLink>
      </header>
      <main className="mt-4">
        <Outlet />
      </main>
    </div>
  );
}
```

```tsx
// src/pages/NotFound.tsx
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div>
      <h1 className="text-xl font-bold">Page not found</h1>
      <Link to="/" className="text-indigo-600 underline">Back home</Link>
    </div>
  );
}
```

(`Home` and `Projects` can start as `<h1>` stubs.)

Line by line:
- `createBrowserRouter` builds the router from the route array; `RouterProvider` gives the whole app access to it.
- `RootLayout` has **no path of its own beyond `/`**. It wraps every child. The `<Outlet />` is where `Home`, `Projects`, or `NotFound` appears. Without it, children render nothing.
- `end` on the Home `NavLink` means "only active at exactly `/`." Without it, Home would be active on every page, because every path starts with `/`.
- `className` accepts a **function** that receives `{ isActive }`, so the active link can be styled.
- `path: "*"` is a **catch-all**: it matches any URL no other route matched, which makes it the 404 page.

> **Placeholder (later lessons):** the older `<BrowserRouter><Routes><Route …/></Routes></BrowserRouter>` style is the same idea in JSX form but doesn't support loaders and actions. Code-splitting routes with `lazy` belongs to **Performance Optimization**.

**Why it matters**
Layout routes remove duplication (one navbar, many pages), and active-link styling is a basic expectation for every multi-page UI.

**Mental model**
Think of the route array as a **table of contents** and `<Outlet />` as a **picture frame**: the layout is the frame, and the matching child is the picture.

**Common beginner mistakes**
- **Mistake:** `<a href="/projects">` for in-app links.
  **Symptom:** A full page reload (the tab spinner flashes, React state resets).
  **Fix:** Use `<Link to="/projects">`.
- **Mistake:** Forgetting `<Outlet />` in the layout.
  **Symptom:** The navbar shows, but the page body is blank.
  **Fix:** Render `<Outlet />` where children should appear.
- **Mistake:** No `end` on the `/` NavLink.
  **Symptom:** "Home" is highlighted on every page.
  **Fix:** Add `end`.
- **Mistake:** Mixing imports from `react-router` and `react-router-dom`.
  **Symptom:** Context errors (see 3.2).
  **Fix:** One package throughout.

**Try it (4 min)**
Visit `/does-not-exist` and confirm the 404 page appears *inside* the layout (with the navbar). Then replace one `NavLink` with a plain `<a href>` and watch the Network tab show a document reload.

**Project step: Milestone 2 (about 30 min)**
Build `main.tsx`, `router.tsx`, `RootLayout`, `Home`, `Projects` (stub), and `NotFound`.

---

### 3.4 Dynamic Routes, Params, and Nested Routes

**Explanation**
A path segment starting with `:` is a **dynamic segment**: it matches any value and exposes it as a **route param**. `/projects/:projectId` matches `/projects/3`, and `useParams()` returns `{ projectId: "3" }`. Routes nest to model screens-within-screens: a project page with **Overview** and **Tasks** tabs is a layout route with two children.

```tsx
// src/router.tsx (updated children)
{
  path: "projects",
  children: [
    { index: true, element: <Projects /> },
    { path: "new", element: <NewProject /> },
    {
      path: ":projectId",
      element: <ProjectLayout />,
      children: [
        { index: true, element: <ProjectOverview /> },
        { path: "tasks", element: <TaskList /> },
      ],
    },
  ],
},
```

```tsx
// src/layouts/ProjectLayout.tsx
import { NavLink, Outlet, useParams } from "react-router";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "border-b-2 border-indigo-600 pb-1 font-semibold" : "pb-1 text-slate-500";

export default function ProjectLayout() {
  const { projectId } = useParams();

  return (
    <div>
      <h1 className="text-xl font-bold">Project #{projectId}</h1>
      <nav className="mt-2 flex gap-4">
        <NavLink to="." end className={tabClass}>Overview</NavLink>
        <NavLink to="tasks" className={tabClass}>Tasks</NavLink>
      </nav>
      <div className="mt-4">
        <Outlet />
      </div>
    </div>
  );
}
```

Line by line:
- `projects` has **no element**, only children. It exists to **group** URLs under a prefix and renders its child directly.
- Route order doesn't decide the winner: `new` and `:projectId` can both match `/projects/new`, but React Router **ranks routes by specificity**, so the static `new` beats the dynamic `:projectId`. (This differs from Express, where the first registered route wins, so order matters.)
- `to="."` with `end` links to the layout's own URL (`/projects/3`) and `to="tasks"` is a **relative link** that resolves against the current route (`/projects/3/tasks`). Relative links keep nested routes portable.
- `useParams()` returns an object of **strings** (or `undefined` if the param is missing). `projectId` is `string | undefined`.

**Why it matters**
Detail pages (`/users/42`, `/orders/abc`) and tabbed screens are in nearly every product. Params are how the URL tells a component *which* thing to show.

**Mental model**
Express: `app.get("/projects/:id", (req) => req.params.id)`. React Router: `useParams().projectId`. Same idea, the same colon syntax, on the client.

**Common beginner mistakes**
- **Mistake:** Comparing a param to a number: `project.id === projectId`.
  **Symptom:** Never matches (`1 === "1"` is false), so the page shows "not found."
  **Fix:** Convert: `Number(projectId)` (and validate it; see 3.8).
- **Mistake:** A leading slash in a relative link: `<NavLink to="/tasks">`.
  **Symptom:** It jumps to the site root's `/tasks` (404) instead of `/projects/3/tasks`.
  **Fix:** Drop the slash for relative links.
- **Mistake:** Forgetting the `index` child.
  **Symptom:** `/projects/3` shows the tabs but a blank body.
  **Fix:** Add `{ index: true, element: … }`.
- **Mistake:** Assuming route order matters like in Express.
  **Symptom:** Needless worry or reordering.
  **Fix:** Specificity ranking decides.

**Try it (4 min)**
Create stub `ProjectOverview`, `TaskList`, and `NewProject` components, then visit `/projects/new`, `/projects/7`, and `/projects/7/tasks` and note which element renders for each.

**Project step: Milestone 3 (about 25 min)**
Add the nested route tree and `ProjectLayout`. Link project names to `/projects/:id` from a hard-coded list on the Projects page.

---

### 3.5 Programmatic Navigation and the URL as State

**Explanation**
**`useNavigate()`** returns a function for navigating from *code*: after an action, on a timer, or in response to something that isn't a click. For ordinary clicks use `Link` (it's a real `<a>`, so right-click, open in a new tab, and screen readers all work). `navigate("/projects")` pushes a history entry, `navigate(-1)` goes back, and `{ replace: true }` replaces the current entry instead of adding one.

**`useSearchParams()`** reads and writes the **query string** (`?q=alpha&status=active&page=2`). Putting filters in the URL is **URL state**: it survives refresh, works with back/forward, and can be shared.

```tsx
// src/pages/Projects.tsx (filters from the URL; data comes in 3.7)
import { useSearchParams } from "react-router";
import type { ProjectStatus } from "../types";

function parseStatus(value: string | null): ProjectStatus | undefined {
  return value === "active" || value === "archived" ? value : undefined;
}

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const status = parseStatus(searchParams.get("status"));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const setParam = (key: string, value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page"); // a new filter restarts at page 1
        return next;
      },
      { replace: key === "q" } // typing shouldn't add a history entry per keystroke
    );

  return (
    <section>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setParam("q", e.target.value)} placeholder="Search…" className="flex-1 rounded border p-2" />
        <select value={status ?? ""} onChange={(e) => setParam("status", e.target.value)} className="rounded border p-2">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <p className="mt-2 text-slate-600">q="{q}" · status={status ?? "any"} · page {page}</p>
    </section>
  );
}
```

> **Version note:** The functional form of `setSearchParams((prev) => …)` and the `{ replace }` option are supported by current React Router versions. Confirm against the version you install.

Line by line:
- Every value from the URL is a **string** (or `null`), so the page number is parsed, and `|| 1` guards against `NaN` for input like `?page=abc`.
- `parseStatus` **validates** the string against the allowed values, so a hand-edited URL can't put garbage into your code.
- The input is **controlled by the URL**: its `value` comes from `searchParams`, and `onChange` writes back to it. There's no separate `useState` for the query.
- Changing a filter deletes `page`, so the user doesn't end up on page 5 of a result set that now has two pages.
- `replace: true` for typing keeps the back button from stepping through every keystroke.

**Why it matters**
"Send me the link to that filtered view" is a core user need, and URL state also gives you refresh-safety and back-button behavior for free.

**Mental model**
Vanilla JS: `new URLSearchParams(location.search)`. `useSearchParams` is that, plus re-rendering when the URL changes. The URL is a **global, shareable, persistent `useState`**.

**Common beginner mistakes**
- **Mistake:** Keeping filters in `useState` only.
  **Symptom:** Refresh clears them, links can't be shared, and back doesn't undo them.
  **Fix:** Put them in search params.
- **Mistake:** Trusting URL values.
  **Symptom:** `?page=abc` gives `NaN`, and `?status=hacked` reaches the API.
  **Fix:** Parse and validate every param (as above).
- **Mistake:** Using `NavLink` for filter tabs that differ only in the query string.
  **Symptom:** *Every* tab looks active, because `NavLink` compares the **pathname** only.
  **Fix:** Compute "is this the current filter?" from `searchParams` and style a `Link` yourself (used in the exercise).
- **Mistake:** Pushing a new history entry per keystroke.
  **Symptom:** The back button needs 12 clicks to leave the page.
  **Fix:** `{ replace: true }` for typing.
- **Mistake:** Using `navigate()` for plain links.
  **Symptom:** No right-click/open-in-new-tab, poor accessibility.
  **Fix:** Use `Link`.

**Try it (4 min)**
Type a search, pick a status, refresh the page, and copy the URL into a new tab. Both should restore the same filters. Then change the URL to `?page=abc` by hand and confirm nothing breaks.

**Project step: Milestone 4 (about 30 min)**
Build the search/status controls, a Prev/Next pager that only changes `page`, and a "New project" `Link` to `/projects/new`. The list stays hard-coded until 3.7.

---

### 3.6 The API Client Layer

**Explanation**
Don't scatter `fetch` calls through components. Create **one typed API client**: a generic `request<T>()` function plus a `projectsApi` object. Components call `projectsApi.list(...)` and never build URLs or parse errors themselves. This is also the single place to later add auth headers or change the base URL.

```ts
// src/types.ts
export type ProjectStatus = "active" | "archived";

export interface Project { id: number; name: string; description: string; status: ProjectStatus }
export interface Task { id: number; projectId: number; title: string; done: boolean }
export interface Page<T> { items: T[]; total: number; page: number; limit: number }
export interface NewProject { name: string; description: string }

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };
```

```ts
// src/api/client.ts
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE_URL: string = import.meta.env.VITE_API_URL ?? "";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

```ts
// src/api/projects.ts
import { request } from "./client";
import type { NewProject, Page, Project, ProjectStatus, Task } from "../types";

export interface ListParams { q?: string; status?: ProjectStatus; page?: number }

export const projectsApi = {
  list(params: ListParams = {}, signal?: AbortSignal) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.page) qs.set("page", String(params.page));
    const query = qs.toString();
    return request<Page<Project>>(`/api/projects${query ? `?${query}` : ""}`, { signal });
  },
  get: (id: number | string, signal?: AbortSignal) => request<Project>(`/api/projects/${id}`, { signal }),
  tasks(id: number | string, opts: { done?: boolean } = {}, signal?: AbortSignal) {
    const query = opts.done === undefined ? "" : `?done=${opts.done}`;
    return request<Task[]>(`/api/projects/${id}/tasks${query}`, { signal });
  },
  create: (input: NewProject) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  update: (id: number | string, patch: Partial<NewProject & { status: ProjectStatus }>) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number | string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
};
```

> **Version note:** The Vite `react-ts` template's `tsconfig` may enable `verbatimModuleSyntax` (use `import type` for type-only imports) and `erasableSyntaxOnly` (no constructor parameter properties or `enum`). `ApiError` declares its `status` field explicitly for that reason. Verify against your generated `tsconfig`.

Line by line:
- `AsyncState<T>` is a **discriminated union** for "loading, error, or success with data," so TypeScript only lets you read `data` when `status === "success"`.
- `if (!res.ok)` is essential: **`fetch` only rejects on network failure**. A 404 or 500 *resolves*, so we convert it to a thrown `ApiError` carrying the server's `{ error }` message.
- `.catch(() => null)` protects against error responses that aren't JSON.
- `204 No Content` has no body, so we return before calling `.json()`.
- `URLSearchParams` builds and **encodes** the query string (spaces, `&`, and so on), so you never hand-concatenate values.
- Every read accepts an optional `signal` so the caller can cancel the request (used in 3.7 and 3.8).
- `import.meta.env.VITE_API_URL` is empty in development (the proxy handles `/api`) and set in production builds. Anything `VITE_`-prefixed is **public**, so never put secrets there.

**Why it matters**
A single API module gives you consistent error handling, one place to change URLs, and fully typed calls. It's what makes the later swap from `useEffect` to loaders almost mechanical.

**Mental model**
`projectsApi` is your own small **SDK**, like the client library of a third-party service, but for your backend.

**Common beginner mistakes**
- **Mistake:** Assuming `fetch` throws on 404/500.
  **Symptom:** The error body is parsed as data, and later `Cannot read properties of undefined`.
  **Fix:** Check `res.ok` and throw, as above.
- **Mistake:** Building query strings by concatenation (`"?q=" + q`).
  **Symptom:** Broken requests when the value has `&`, `#`, or spaces.
  **Fix:** `URLSearchParams`.
- **Mistake:** Hard-coding `http://localhost:3001` in components.
  **Symptom:** CORS errors, and it breaks in production.
  **Fix:** Relative `/api/...` plus the dev proxy, and an env var for production.
- **Mistake:** Parsing `res.json()` on a 204.
  **Error message:** `Unexpected end of JSON input`.
  **Fix:** Return early for 204.

**Try it (3 min)**
In a temporary `useEffect` in `Home`, call `projectsApi.list({ q: "project 1" }).then(console.log)` and `projectsApi.get(999).catch((e) => console.log(e.status, e.message))`, then delete the effect.

**Project step: Milestone 5 (about 20 min)**
Create `types.ts`, `api/client.ts`, `api/projects.ts`, and verify both calls in the console.

---

### 3.7 Fetching Data in Components with `useEffect`

**Explanation**
This is the approach learners already know: fetch in an effect, store the result in state, and render by status. Two things are new because of routing:

1. **Params and search params are effect dependencies.** When the URL changes, the effect must re-run.
2. **The component instance is reused across param changes.** Going from `/projects/1` to `/projects/2` does **not** unmount `ProjectOverview`. It re-renders with a new `projectId`. If the effect ignores that, you see stale data.

```tsx
// src/pages/Projects.tsx (the list, effect version)
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { projectsApi } from "../api/projects";
import type { AsyncState, Page, Project, ProjectStatus } from "../types";

function parseStatus(v: string | null): ProjectStatus | undefined {
  return v === "active" || v === "archived" ? v : undefined;
}

export default function Projects() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const status = parseStatus(searchParams.get("status"));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [state, setState] = useState<AsyncState<Page<Project>>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    projectsApi
      .list({ q, status, page }, controller.signal)
      .then((data) => setState({ status: "success", data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ status: "error", message: err instanceof Error ? err.message : "Something went wrong" });
      });

    return () => controller.abort();
  }, [q, status, page]);

  if (state.status === "loading") return <p className="animate-pulse text-slate-500">Loading projects…</p>;
  if (state.status === "error") return <p role="alert" className="text-red-600">{state.message}</p>;

  return (
    <ul className="space-y-2">
      {state.data.items.map((p) => (
        <li key={p.id}>
          <Link to={`/projects/${p.id}`} className="text-indigo-600 hover:underline">{p.name}</Link>
          <span className="ml-2 text-xs uppercase text-slate-500">{p.status}</span>
        </li>
      ))}
    </ul>
  );
}
```

> **Placeholders (later lessons):** the early returns and ternaries are the subject of **Conditional Rendering**, `.map()` with `key` belongs to **Lists and Keys**, and repeating this fetch pattern in every component is the cue for **Custom Hooks** and **TanStack Query**. Keep the search/status controls from 3.5 above this list (they live in the same component).

```tsx
// src/pages/ProjectOverview.tsx (the detail, effect version)
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { projectsApi } from "../api/projects";
import type { AsyncState, Project } from "../types";

export default function ProjectOverview() {
  const { projectId } = useParams();
  const [state, setState] = useState<AsyncState<Project>>({ status: "loading" });

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setState({ status: "loading" });

    projectsApi
      .get(projectId, controller.signal)
      .then((data) => setState({ status: "success", data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ status: "error", message: err instanceof Error ? err.message : "Something went wrong" });
      });

    return () => controller.abort(); // cancels the previous project's request
  }, [projectId]);

  if (state.status === "loading") return <p className="animate-pulse text-slate-500">Loading…</p>;
  if (state.status === "error") return <p role="alert" className="text-red-600">{state.message}</p>;
  return <p>{state.data.description}</p>;
}
```

Line by line:
- The dependency array is `[q, status, page]` (primitives), not `searchParams` (an object). **Depend on the primitive values you actually use.**
- `AbortController` + cleanup cancels the previous request when dependencies change or the component unmounts. The `AbortError` check keeps that expected cancellation from showing as an error.
- `[projectId]` makes the detail effect re-run on navigation between projects.

**Demonstrate the race (do this live).** Project 1 is slow (1.5 s), project 2 is fast (0.4 s). Open `/projects/1`, then immediately click to `/projects/2`. Remove the `controller.abort()` cleanup and watch project 1's late response **overwrite** project 2's page (a **race condition**: the result depends on which response arrives last). Put the cleanup back and the stale response is cancelled.

> **Version note:** In development, `<StrictMode>` mounts, unmounts, and re-mounts components once, so each effect runs twice and you'll see two requests. That's expected, and the cleanup makes it harmless. Also, newer versions of `eslint-plugin-react-hooks` may warn about calling `setState` synchronously inside an effect (`setState({ status: "loading" })` above). Check your lint output. Loaders (next section) avoid this pattern altogether.

**Why it matters**
Even if you move to loaders or a data library later, you'll read and maintain `useEffect` fetching in most existing codebases. Knowing *why* it needs dependencies and cleanup is what prevents the nastiest bugs: stale data and races.

**Mental model**
Each render is a snapshot with its own `projectId`. The effect says "whenever *this* value changes, go get the matching data, and cancel the previous trip if it hasn't returned."

**Common beginner mistakes**
- **Mistake:** An empty dependency array on a param-driven effect: `useEffect(() => …, [])`.
  **Symptom:** Navigating from project 1 to 2 changes the URL but **shows project 1's data**.
  **Fix:** Add `projectId` to the dependencies.
- **Mistake:** No cleanup/abort.
  **Symptom:** The race above: the wrong project flashes or sticks.
  **Fix:** `AbortController` + `return () => controller.abort()`.
- **Mistake:** Passing a non-primitive (like the `searchParams` object or an inline object) as a dependency.
  **Symptom:** The effect re-runs on every render (request storm).
  **Fix:** Depend on primitives (`q`, `status`, `page`).
- **Mistake:** `useParams()` value used as a number.
  **Symptom:** `NaN` in URLs or failed comparisons.
  **Fix:** Pass the string straight to the API, or validate with `Number()` first.
- **Mistake:** An `async` effect callback.
  **Symptom:** React warns that effect callbacks must be synchronous.
  **Fix:** Use `.then()` chains or an inner async function.

**Try it (5 min)**
Do the race demo above. Then change the detail effect's dependency array to `[]` and watch the stale-data bug appear.

**Project step: Milestone 6 (about 35 min)**
Wire the list (with filters and pager) and the detail overview to the API with `useEffect`. Verify loading, error (stop the server), and empty states.

---

### 3.8 Loaders: Route-Level Data Fetching

**Explanation**
A **loader** is a function attached to a route that **fetches the data before the route renders**. The router calls it whenever the URL changes, passes it the `params` and the `request` (including the URL and an abort `signal`), and gives the result to your component through **`useLoaderData()`**. Loaders replace the `useState` + `useEffect` + loading flag + cleanup for that route.

What the router gives you for free:
- **No effect, no loading state variable.** The component renders only when its data exists.
- **Cancellation:** `request.signal` aborts automatically if the user navigates away mid-flight.
- **Parallel loading:** loaders for nested routes run **at the same time** (no parent-then-child waterfall).
- **Pending UI** via `useNavigation()`, while the **previous page stays visible** instead of flashing a blank screen.

```ts
// src/lib/parse.ts
import type { ProjectStatus } from "../types";

export function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Response("Not found", { status: 404 });
  return id;
}

export function parseStatus(v: string | null): ProjectStatus | undefined {
  return v === "active" || v === "archived" ? v : undefined;
}
```

```ts
// src/loaders.ts
import type { LoaderFunctionArgs } from "react-router";
import { ApiError } from "./api/client";
import { projectsApi } from "./api/projects";
import { parseId, parseStatus } from "./lib/parse";

export async function projectsLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return projectsApi.list(
    {
      q: url.searchParams.get("q") ?? "",
      status: parseStatus(url.searchParams.get("status")),
      page: Math.max(1, Number(url.searchParams.get("page")) || 1),
    },
    request.signal
  );
}

export async function projectLoader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.projectId);
  try {
    return await projectsApi.get(id, request.signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new Response("Project not found", { status: 404 });
    throw err;
  }
}

export async function tasksLoader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.projectId);
  return projectsApi.tasks(id, {}, request.signal);
}
```

```tsx
// src/router.tsx (attach loaders)
{ index: true, element: <Projects />, loader: projectsLoader },
// ...
{
  path: ":projectId",
  element: <ProjectLayout />,
  children: [
    { index: true, element: <ProjectOverview />, loader: projectLoader },
    { path: "tasks", element: <TaskList />, loader: tasksLoader },
  ],
},
```

```tsx
// src/pages/Projects.tsx (loader version: no useEffect, no useState for data)
import { Link, useLoaderData } from "react-router";
import type { projectsLoader } from "../loaders";

export default function Projects() {
  const { items, total } = useLoaderData() as Awaited<ReturnType<typeof projectsLoader>>;

  return (
    <>
      {/* search/status controls from 3.5 stay here */}
      <p className="text-slate-600">{total} projects</p>
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id}><Link to={`/projects/${p.id}`} className="text-indigo-600 hover:underline">{p.name}</Link></li>
        ))}
      </ul>
    </>
  );
}
```

```tsx
// src/layouts/RootLayout.tsx (add a global pending indicator)
import { NavLink, Outlet, useNavigation } from "react-router";

export default function RootLayout() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle"; // "loading" or "submitting"

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className={busy ? "h-1 animate-pulse bg-indigo-500" : "h-1"} />
      {/* header with NavLinks as before */}
      <main className={busy ? "mt-4 opacity-60 transition-opacity" : "mt-4"}>
        <Outlet />
      </main>
    </div>
  );
}
```

> **Version note:** `useLoaderData()` is untyped in data mode, so we cast with `Awaited<ReturnType<typeof loader>>`. React Router v7 offers generated route types in *framework mode* (out of scope today), and the typing story may differ by version, so verify what your installed version provides. Also, the Vite template's ESLint rule `react-refresh/only-export-components` warns if a component file also exports non-components such as loaders, which is why loaders live in `src/loaders.ts`. (`import type` of a function only uses its type, so nothing is bundled twice.)

Line by line:
- `request.url` is a full URL, so the loader reads search params with `new URL(request.url)`. The router **re-runs** the loader whenever the URL (path or search) changes.
- `request.signal` is passed to the API so a superseded navigation **cancels** the request automatically. There's no manual `AbortController`.
- `parseId` throws a `Response` with status 404 for bad ids (such as `/projects/abc`). That's the router's convention for "this route can't render": the error boundary (3.10) handles it.
- Mapping `ApiError` 404 to a thrown 404 `Response` means "project not found" becomes a normal not-found screen instead of a generic crash.
- The `Projects` component is now just rendering: no `AsyncState`, no switch on status.

**Compare the two approaches (do this as a class discussion):**

| | `useEffect` + state | Loader |
|---|---|---|
| Loading state | You write it | `useNavigation()`; old page stays visible |
| Cancellation | Manual `AbortController` | Automatic (`request.signal`) |
| Params → data | Dependency array | URL change re-runs loader |
| Parallel nested data | Easy to waterfall | Parallel by default |
| Where it lives | Inside the component | On the route |
| Best for | Non-route data, widgets | Page-level data |

> **Placeholders (later lessons):** streaming data with `defer`/`Await`, `Suspense`, and React 19's `use()` are covered in **Advanced Rendering**; caching and background refetching are **TanStack Query**.

**Why it matters**
Page-level data is the most common data in an app. Fetching it at the route removes a whole category of loading/race/cleanup code and makes navigation feel faster.

**Mental model**
A loader is the **`await` before the page appears**, like a server-rendered page that waits for its data, except it runs in the browser.

**Common beginner mistakes**
- **Mistake:** Using a hook (`useParams`, `useState`) inside a loader.
  **Error message:** `Invalid hook call`.
  **Fix:** Loaders are plain functions. Read `params` and `request` from their argument.
- **Mistake:** Forgetting to `return` the data.
  **Symptom:** `useLoaderData()` is `undefined`, and destructuring crashes.
  **Fix:** `return` it (or return the awaited call).
- **Mistake:** Sequential `await`s for independent data.
  **Symptom:** A waterfall (slow pages).
  **Fix:** `await Promise.all([a(), b()])`.
- **Mistake:** Reading `window.location` or search params from the *component* inside a loader's logic.
  **Symptom:** Stale values.
  **Fix:** Use `request.url` in the loader.
- **Mistake:** Catching an error in the loader and returning `null`.
  **Symptom:** The component renders with missing data and crashes later.
  **Fix:** Throw, and let the error boundary (3.10) render the failure.

**Try it (5 min)**
Navigate from `/projects/1` straight to `/projects/2` and compare with the effect version: no flash of a loading placeholder, the old page dims, and project 2 appears without any race.

**Project step: Milestone 7 (about 35 min)**
Create `parse.ts` and `loaders.ts`, attach loaders for the list, overview, and tasks, delete the effect/state code from those pages, and add the pending indicator to `RootLayout`.

---

### 3.9 Actions: Creating, Editing, and Deleting with Forms

**Explanation**
An **action** is the write-side twin of a loader: a function on a route that runs when a **`<Form>`** is submitted. The router calls it with the `request`, you read the submitted data with `request.formData()`, call the API, and then either **return data** (such as validation errors) or **`redirect`** to another URL.

After an action completes, the router **automatically re-runs the active loaders** (**revalidation**). The list and detail pages refresh with the new server data. That's the part that is manual and error-prone with `useEffect`.

```tsx
// src/actions.ts
import { redirect, type ActionFunctionArgs } from "react-router";
import { projectsApi } from "./api/projects";
import { parseId } from "./lib/parse";

export interface FormError { error: string }

function readForm(form: FormData) {
  return {
    name: String(form.get("name") ?? "").trim(),
    description: String(form.get("description") ?? "").trim(),
  };
}

export async function createProjectAction({ request }: ActionFunctionArgs): Promise<FormError | Response> {
  const { name, description } = readForm(await request.formData());
  if (name.length < 3) return { error: "Name must be at least 3 characters" };
  try {
    const project = await projectsApi.create({ name, description });
    return redirect(`/projects/${project.id}`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the project" };
  }
}

export async function updateProjectAction({ request, params }: ActionFunctionArgs): Promise<FormError | Response> {
  const id = parseId(params.projectId);
  const { name, description } = readForm(await request.formData());
  if (name.length < 3) return { error: "Name must be at least 3 characters" };
  try {
    await projectsApi.update(id, { name, description });
    return redirect(`/projects/${id}`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save changes" };
  }
}

export async function deleteProjectAction({ params }: ActionFunctionArgs) {
  await projectsApi.remove(parseId(params.projectId));
  return redirect("/projects");
}
```

```tsx
// src/pages/NewProject.tsx
import { Form, useActionData, useNavigation } from "react-router";
import type { FormError } from "../actions";

export default function NewProject() {
  const actionData = useActionData() as FormError | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <Form method="post" className="space-y-3">
      <input name="name" placeholder="Project name" className="w-full rounded border p-2" />
      <textarea name="description" placeholder="Description" className="w-full rounded border p-2" />
      {actionData?.error && <p role="alert" className="text-red-600">{actionData.error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-indigo-600 px-3 py-1 text-white disabled:opacity-50">
        {submitting ? "Creating…" : "Create project"}
      </button>
    </Form>
  );
}
```

```tsx
// src/pages/ProjectOverview.tsx (loader version with delete)
import { Form, useLoaderData } from "react-router";
import type { projectLoader } from "../loaders";

export default function ProjectOverview() {
  const project = useLoaderData() as Awaited<ReturnType<typeof projectLoader>>;

  return (
    <div className="space-y-3">
      <p>{project.description || "No description."}</p>
      <Form
        method="post"
        action={`/projects/${project.id}/delete`}
        onSubmit={(e) => { if (!confirm("Delete this project?")) e.preventDefault(); }}
      >
        <button type="submit" className="rounded bg-red-600 px-3 py-1 text-white">Delete</button>
      </Form>
    </div>
  );
}
```

```tsx
// src/router.tsx (final project routes)
{
  path: "projects",
  children: [
    { index: true, element: <Projects />, loader: projectsLoader },
    { path: "new", element: <NewProject />, action: createProjectAction },
    {
      path: ":projectId",
      element: <ProjectLayout />,
      children: [
        { index: true, element: <ProjectOverview />, loader: projectLoader },
        { path: "tasks", element: <TaskList />, loader: tasksLoader },
        { path: "edit", element: <EditProject />, loader: projectLoader, action: updateProjectAction },
        { path: "delete", action: deleteProjectAction },
      ],
    },
  ],
},
```

`EditProject` is `NewProject` with `defaultValue={project.name}` and `defaultValue={project.description}` from `useLoaderData()`, and the same `<Form method="post">` (it posts to its own route's action).

Line by line:
- `<Form>` (capital F) is the router's form. It intercepts submit, sends the data to the **route's action** *without a page reload*, and then triggers revalidation. A plain `<form>` would submit to the server URL and reload the page.
- Inputs need a **`name`**: `request.formData()` is keyed by `name`. An input without one is simply absent from the data.
- Expected failures (validation, a 400 from the API) are **returned as data** and shown with `useActionData()`. Unexpected failures should **throw** and be handled by the error boundary (3.10).
- `return redirect(...)`: `redirect()` only **builds** a response. You must **return** it.
- After `redirect`, the router loads the destination route's loader, so the new project's page is fresh. When the delete action redirects to `/projects`, the list loader runs again and the deleted project is gone, with no manual state updates.
- The `delete` route has **no element**, only an `action`. It exists purely as a mutation endpoint.
- `useNavigation().state === "submitting"` drives a disabled button and "Creating…" text, which also **prevents double-submits**.
- Inputs are **uncontrolled** here (`name` and `defaultValue`): the browser holds the value and the router reads it on submit. You don't need `useState` for each field.

> **Placeholder (later lesson):** `useFetcher` lets you submit mutations **without navigating** (for example a "star" toggle in a list), and optimistic UI builds on it. We keep full-page `Form` submissions today.

**Why it matters**
Creating, editing, and deleting are in every product. Actions give you one consistent pattern: submit, validate, call the API, redirect, and refresh the data, without hand-written "refetch after save" code.

**Mental model**
Vanilla JS: `form.addEventListener("submit", e => { e.preventDefault(); fetch(…); updateDOM(); })`. Here the router does the interception and the re-render, and the action is the `fetch` part.

**Common beginner mistakes**
- **Mistake:** A lowercase `<form>` instead of `<Form>`.
  **Symptom:** The browser does a full page submit (and reloads, losing state); no action runs.
  **Fix:** `import { Form } from "react-router"`.
- **Mistake:** Inputs without `name`.
  **Symptom:** The server gets empty fields ("Name must be at least 3 characters" every time).
  **Fix:** Add `name="…"` to every field.
- **Mistake:** Calling `redirect("/projects")` without `return`.
  **Symptom:** The action finishes, nothing navigates, and you stay on the form.
  **Fix:** `return redirect(...)`.
- **Mistake:** Throwing for validation errors.
  **Symptom:** The whole route is replaced by the error screen.
  **Fix:** Return `{ error }` and render it with `useActionData`.
- **Mistake:** Forgetting that loaders re-run after actions and manually refetching.
  **Symptom:** Duplicate requests and flicker.
  **Fix:** Trust revalidation.
- **Mistake:** Forgetting the pending state.
  **Symptom:** Users click twice and create duplicates.
  **Fix:** Disable the button while `navigation.state === "submitting"`.

**Try it (5 min)**
Submit the create form with a 2-character name and confirm the server's 400 message appears *inside* the form without a reload. Then create a valid project and see it appear at the top of `/projects`.

**Project step: Milestone 8 (about 40 min)**
Build `actions.ts`, the create and edit pages, and the delete button. Add the `edit`/`delete` routes and verify revalidation (create then watch the list update with no manual refetch).

---

### 3.10 Error Handling and Not-Found Pages

**Explanation**
When a loader, action, or component **throws**, the router renders the nearest **error boundary** for that route: the route's **`errorElement`**. Inside it, **`useRouteError()`** gives the thrown value and **`isRouteErrorResponse()`** tells you whether it's a thrown `Response` (such as our 404) or a real `Error` (such as a network failure).

```tsx
// src/pages/RouteError.tsx
import { isRouteErrorResponse, Link, useRouteError } from "react-router";

export default function RouteError() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div role="alert">
        <h1 className="text-xl font-bold">{error.status === 404 ? "Not found" : `Error ${error.status}`}</h1>
        <p>{error.status === 404 ? "We couldn't find what you were looking for." : error.statusText}</p>
        <Link to="/projects" className="text-indigo-600 underline">Back to projects</Link>
      </div>
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <div role="alert">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="text-slate-600">{message}</p>
    </div>
  );
}
```

```tsx
// src/router.tsx (error boundaries at two levels)
export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteError />,      // last resort: replaces the whole page
    children: [
      { index: true, element: <Home /> },
      {
        path: "projects",
        children: [
          // ...
          {
            path: ":projectId",
            element: <ProjectLayout />,
            errorElement: <RouteError />, // scoped: navbar stays, only the project area shows the error
            children: [ /* ... */ ],
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
```

> **Version note:** `errorElement` is the established property. React Router v7 also supports an `ErrorBoundary` property that takes a component instead of an element. Confirm which your installed version documents as preferred.

Line by line:
- An error thrown in a child route's loader renders the **nearest** `errorElement` up the tree. A boundary on `:projectId` keeps the root navbar visible, while only the project area shows the problem.
- `isRouteErrorResponse(error)` narrows to `{ status, statusText, data }`. `parseId` and `projectLoader` throw 404 responses, so `/projects/abc` and `/projects/9999` both render the friendly "Not found."
- The `*` catch-all handles **URLs that match no route**. A **thrown 404** (the project doesn't exist) is handled by `errorElement`. They're different mechanisms for the same user-facing idea.
- If a loader throws a plain `ApiError` (for example the server is down), `error instanceof Error` shows its message.

> **Placeholder (later lesson):** React's own **Error Boundaries** (for render-time errors anywhere in the tree) are covered in **Advanced Rendering**. Route `errorElement`s are the router's version.

**Why it matters**
Every real API fails sometimes. A clear, scoped error screen with a way back is the difference between "the app is broken" and "that project doesn't exist."

**Mental model**
`try/catch` for routes: the loader or action *throws*, and the nearest `errorElement` is the `catch` block that decides what to render.

**Common beginner mistakes**
- **Mistake:** No `errorElement`.
  **Symptom:** The router's default, unstyled "Unexpected Application Error!" screen.
  **Fix:** Add boundaries at least at the root and at big sections.
- **Mistake:** Only a root-level `errorElement`.
  **Symptom:** A missing project wipes the navbar and the whole layout.
  **Fix:** Add a scoped boundary on the nested route.
- **Mistake:** Treating the `*` route as the not-found handler for missing data.
  **Symptom:** `/projects/9999` shows a broken page.
  **Fix:** Throw a 404 `Response` from the loader.
- **Mistake:** Swallowing errors with `catch { return null }`.
  **Symptom:** A blank or half-rendered page and no error signal.
  **Fix:** Let it throw.

**Try it (4 min)**
Visit `/projects/9999`, `/projects/abc`, and `/nowhere`. Then stop the API server and open `/projects`. Note which screen each one shows and why.

**Project step: Milestone 9 (about 15 min)**
Add `RouteError` with root and project-level boundaries, and verify all four cases above.

---

### 3.11 Putting It Together: Choosing an Approach and Shipping

**Explanation**
You now have two ways to bring API data into a screen. Use this guide:

| Situation | Use |
|---|---|
| Data defines the **page** (list, detail, edit form) | **Loader** (+ **action** for writes) |
| Data for a **widget** or small piece not tied to a route | `useEffect` + `fetch` |
| Needs caching, background refresh, retries, shared across many components | A data library (**TanStack Query**, a later lesson) |
| Only the visible filter/selection state | URL state (`useSearchParams`) |

Other topics to name, but not teach today:
- **Protected routes** (redirecting logged-out users) need authentication and shared state, so they belong to **Authentication** and **Context**.
- **Route code-splitting** (`lazy`) is part of **Performance Optimization**.

**Shipping an SPA: the fallback rule.** `npm run build` produces static files. The server that hosts them must return `index.html` for any path that isn't a real file, or refreshing `/projects/3` returns the host's 404.

```bash
npm run build
npm run preview   # serves dist/ locally
```

Hosts configure the fallback differently (for example a `_redirects` file on Netlify, rewrites on Vercel, `try_files … /index.html` in Nginx). Check your host's current documentation.

> **Version note:** `vite preview` mimics a static host with SPA fallback behavior, so it won't reproduce the 404 a strict static server would give. Verify deep links on the real host after deploying. Set `VITE_API_URL` at build time if your API lives on a different origin, and make sure that API allows your site's origin (CORS).

**Why it matters**
Choosing the right tool per situation, and knowing the deployment gotcha, are what turn a tutorial app into a shippable one.

**Mental model**
Loaders and actions handle **pages**, effects handle **widgets**, a library handles **shared caches**, and the URL holds **shareable state**.

**Common beginner mistakes**
- **Mistake:** Using one approach everywhere.
  **Symptom:** Effects for page data (races and boilerplate), or loaders for tiny widgets (over-engineering).
  **Fix:** Pick per situation using the table.
- **Mistake:** Deploying without SPA fallback.
  **Symptom:** Deep links and refreshes 404 in production only.
  **Fix:** Configure the host's rewrite rule.
- **Mistake:** Forgetting `VITE_API_URL` in the production build.
  **Symptom:** Requests go to the static host (`/api/...` returns HTML or 404).
  **Fix:** Set it at build time.

**Try it (3 min)**
Run `npm run build && npm run preview`, open `/projects/3`, and refresh. Write one sentence on what a static host would need to make that work.

**Project step: Milestone 10 (about 10 min)**
Build and preview, then write a three-line README note on the SPA fallback and `VITE_API_URL`.

---

## 4. How the Sub-Sections Connect

**Dependency order**

```
3.1 Why routing (SPA, History API, URL)        [the idea]
   │
3.2 Setup: client + starter API + proxy        [a place to practice; the API all later steps call]
   │
3.3 Routes, Link/NavLink, layouts + Outlet     [the router exists; navigation works]
   │
3.4 Dynamic routes, params, nested routes      [needs 3.3; URLs now identify "which thing"]
   │
3.5 useNavigate + search params (URL state)    [needs 3.3-3.4; filters live in the URL]
   │
3.6 Typed API client                           [independent of routing; needed by 3.7-3.9]
   │
3.7 Fetch with useEffect                       [needs 3.4-3.6; params/search params become effect deps; races]
   │
3.8 Loaders                                    [needs 3.6; REPLACES 3.7's effects with route-level fetching]
   │
3.9 Actions                                    [needs 3.8; writes + automatic revalidation]
   │
3.10 Error boundaries + 404                    [needs 3.8-3.9; where thrown errors land]
   │
3.11 Choosing an approach + shipping           [synthesizes everything]
```

**Hierarchy:** 3.1-3.5 are **routing** (what to show for a URL). 3.6 is the **bridge** (a typed API layer). 3.7-3.10 are **API integration**, taught first in the familiar way (3.7) and then the router-native way (3.8-3.10). 3.11 is **decision-making and delivery**.

**Key relationship:** 3.7 and 3.8 solve the *same* screens in two ways. Teach 3.7 first so learners feel the pain (dependencies, cleanup, races), then 3.8 so the loader's value is obvious.

**Project thread:** ProjectHub grows in ten milestones: setup → layout → dynamic routes → URL filters → API client → effect fetching → loaders → actions → error boundaries → build and preview.

**Suggested live-teaching flow (6 hours = 360 min)**

| Clock | Min | Section | Mode |
|---|---|---|---|
| 0:00-0:15 | 15 | 3.1 Why routing | Talk, then run the vanilla router demo live |
| 0:15-0:40 | 25 | 3.2 Setup and starter API | Read the server together, then everyone runs both terminals (Milestone 1) |
| 0:40-1:15 | 35 | 3.3 Routes, links, layouts | Demo the missing-`<Outlet />` bug; learners code Milestone 2 |
| 1:15-1:45 | 30 | 3.4 Dynamic and nested routes | Demo route ranking (`new` vs `:projectId`); Milestone 3 |
| 1:45-1:55 | 10 | Break | |
| 1:55-2:25 | 30 | 3.5 Navigation and URL state | Demo refresh and share-link behavior; Milestone 4 |
| 2:25-2:50 | 25 | 3.6 API client | Live-code `request<T>`; verify in the console (Milestone 5) |
| 2:50-3:05 | 15 | Lunch / longer break | |
| 3:05-3:40 | 35 | 3.7 Fetching with `useEffect` | Provoke the race with slow project 1; Milestone 6 |
| 3:40-4:15 | 35 | 3.8 Loaders | Refactor the same pages live; compare with the table; Milestone 7 |
| 4:15-4:55 | 40 | 3.9 Actions | Build the create form; demo revalidation; Milestone 8 |
| 4:55-5:10 | 15 | 3.10 Errors and 404 | Break things on purpose; Milestone 9 |
| 5:10-5:20 | 10 | 3.11 Choosing and shipping | Decision table; build and preview (Milestone 10) |
| 5:20-5:50 | 30 | Knowledge check and applied exercise | About 10 min questions, 20 min solo on **Task Filters** |
| 5:50-6:00 | 10 | Recap and next-lesson bridge | Review answers and the loader/effect comparison |

*Trim rule if running long:* provide `EditProject` as a download in 3.9, and shorten the 3.2 server read-through.

---

## 5. Key Terms Glossary

*(in order of first appearance)*

- **Single-page application (SPA)**: an app that loads one HTML page and swaps views with JavaScript.
- **Client-side routing**: changing what's shown based on the URL without a full page reload.
- **History API**: the browser API (`pushState`, `popstate`) for changing the URL without reloading.
- **Route**: a rule mapping a URL pattern to a component.
- **Router**: the library that matches the URL against routes and renders the match.
- **SPA fallback**: a host serving `index.html` for unknown paths so deep links work.
- **Layout route**: a parent route that renders shared UI around its children.
- **`<Outlet />`**: the placeholder in a layout where the matching child route renders.
- **Index route**: the child route shown at its parent's exact URL.
- **`Link` / `NavLink`**: router-aware anchors; `NavLink` also knows if it's active.
- **Catch-all route (`*`)**: a route matching any URL nothing else matched.
- **Dynamic segment / route param**: a `:name` URL segment whose value is exposed by `useParams`.
- **Route ranking**: the router picking the most specific matching route, independent of order.
- **Relative link**: a link without a leading slash, resolved against the current route.
- **`useNavigate`**: a hook returning a function that navigates from code.
- **Search params**: the query string (`?q=…`), read and written with `useSearchParams`.
- **URL state**: application state stored in the URL so it's shareable and refresh-safe.
- **Proxy (dev)**: the dev server forwarding `/api` requests to the backend.
- **CORS**: browser rule restricting cross-origin requests unless the server allows them.
- **API client**: one module that wraps `fetch` calls with consistent errors and types.
- **Discriminated union**: a type where a shared field (`status`) tells you which variant you have.
- **`ApiError`**: our error type carrying the HTTP status and server message.
- **`AbortController`**: a browser API to cancel an in-flight `fetch`.
- **Race condition**: a bug where the outcome depends on which async response arrives last.
- **Loader**: a route function that fetches data before the route renders.
- **`useLoaderData`**: the hook returning a route loader's result.
- **`useNavigation`**: the hook exposing global navigation state (`idle`, `loading`, `submitting`).
- **Waterfall**: sequential requests that could have run in parallel.
- **Action**: a route function that handles a form submission (a write).
- **`Form`**: the router's form component that submits to a route action without reloading.
- **`FormData`**: the browser object holding submitted form fields, keyed by `name`.
- **`redirect`**: a helper that builds a navigation response (must be returned).
- **Revalidation**: the router automatically re-running loaders after an action.
- **`useActionData`**: the hook returning what the last action returned (such as validation errors).
- **`errorElement`**: a route's error screen, rendered when a loader, action, or component throws.
- **`isRouteErrorResponse`**: a check telling you whether a thrown value is a response with a status.

---

## 6. Knowledge Check

### Part A: Questions

**Q1 (Recall).** Why should in-app navigation use `<Link>` instead of `<a href>`, and what visible symptom tells you someone used `<a>` by mistake?

**Q2 (Predict the output).** Given this route tree, which element renders for each URL: `/projects/new`, `/projects/42`, `/projects/42/tasks`?

```tsx
{
  path: "projects",
  children: [
    { path: "new", element: <NewProject /> },
    {
      path: ":projectId",
      element: <ProjectLayout />,
      children: [
        { index: true, element: <ProjectOverview /> },
        { path: "tasks", element: <TaskList /> },
      ],
    },
  ],
},
```

**Q3 (Spot the bug).** The detail page always says "Project not found," even for valid ids. Why?

```tsx
const { projectId } = useParams();
const project = projects.find((p) => p.id === projectId); // p.id is a number
```

**Q4 (Spot the bug).** Clicking from `/projects/1` to `/projects/2` changes the URL, but the page still shows project 1. What's wrong, and what second bug lurks if two fast clicks happen?

```tsx
useEffect(() => {
  projectsApi.get(projectId!).then((data) => setState({ status: "success", data }));
}, []);
```

**Q5 (Predict the output).** A user submits the create form with a valid name. What happens, and why?

```ts
export async function createProjectAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const project = await projectsApi.create({ name: String(form.get("name")), description: "" });
  redirect(`/projects/${project.id}`);
}
```

### Part B: Applied mini-exercise: Task Filters

**Goal:** On the Tasks tab, add **All / Open / Done** filters stored in the URL (`?done=open|done`), fetched through the loader, with a pending indicator and a friendly empty state.

**Starter code:**

```ts
// src/lib/parse.ts (add)
export type TaskFilter = "all" | "open" | "done";
// TODO 1: return "open" or "done" when the value matches, otherwise "all"
export function parseTaskFilter(v: string | null): TaskFilter {
  return "all";
}
```

```ts
// src/loaders.ts
// TODO 2: read `done` from request.url, parse it with parseTaskFilter, call
//         projectsApi.tasks(id, { done: ... }, request.signal), and return { tasks, filter }
export async function tasksLoader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.projectId);
  const tasks = await projectsApi.tasks(id, {}, request.signal);
  return { tasks, filter: "all" as const };
}
```

```tsx
// src/pages/TaskList.tsx
import { Link, useLoaderData, useNavigation } from "react-router";
import type { tasksLoader } from "../loaders";

export default function TaskList() {
  const { tasks, filter } = useLoaderData() as Awaited<ReturnType<typeof tasksLoader>>;
  const navigation = useNavigation();

  // TODO 3: render three <Link>s ("All", "Open", "Done") whose destination is the
  //         project's tasks URL with ?done=open / ?done=done (none for "All").
  //         Highlight the current filter (NavLink can't do this: why?).
  // TODO 4: dim the list while navigation.state === "loading".
  // TODO 5: when tasks is empty, show a message that mentions the filter.
  return <p>TODO</p>;
}
```

**Requirements:**
1. `parseTaskFilter` accepts only `"open"` and `"done"`, and anything else (including `null` and hand-typed junk) becomes `"all"`.
2. The loader maps `open` to `done: false`, `done` to `done: true`, and `all` to no `done` param, and passes `request.signal`.
3. The three filter links change **only** the query string, and the current one is visibly highlighted.
4. Changing a filter must not add extra requests beyond the loader's call.
5. An empty result shows a message such as "No open tasks."
6. Invalid `?done=banana` falls back to **All** without an error.

**Acceptance criteria:**
- `/projects/2/tasks?done=open` shows only tasks with `done: false` after a refresh, and the "Open" link is highlighted.
- Clicking "Done" updates the URL to `?done=done`, and the list changes without a full page reload.
- While switching, the list dims (and the global progress bar shows).
- `?done=banana` renders the "All" list.
- TypeScript compiles with no errors, and no `any`.

---

## 7. Summary Recap

- **Routing maps URLs to components.** A router uses the History API so navigation never reloads the page. Use `Link`/`NavLink`, never `<a href>`, and put shared UI in layout routes with an `<Outlet />`.
- **The URL is state.** Route params identify *which* thing (always strings, so validate and convert), and search params hold *shareable* filters. Validate everything you read from the URL.
- **Wrap `fetch` in one typed API client** that checks `res.ok`, throws `ApiError`, encodes query strings with `URLSearchParams`, and accepts an abort `signal`.
- **Effect-based fetching needs dependencies and cleanup.** Depend on primitive params, and abort the previous request, or navigation between detail pages shows stale or racing data.
- **Loaders and actions move page data and mutations onto the route.** You get automatic cancellation, parallel loading, pending UI, and automatic revalidation after writes. Return expected errors as data, and `return redirect(...)`.
- **Plan for failure and for shipping.** Add scoped `errorElement`s, throw 404 responses for missing data, and configure SPA fallback on the host so deep links survive a refresh.

---

## 8. Next Lesson Bridge

ProjectHub is now a multi-page app backed by a real API, but anyone can open any URL and change anything, and every page re-fetches from scratch. The next lessons build on exactly those gaps: **Authentication** adds login and **protected routes** (using Context to share the current user), and **TanStack Query** adds caching, background refetching, and optimistic updates on top of the API client you wrote today.

---

## Instructor Answer Key

**Q1.** `<Link>` is intercepted by the router, which updates the URL with the History API and renders the matching route **without a page reload**. A plain `<a href>` triggers a **full document load**. The visible symptoms are the browser tab's loading indicator and a flash, all React state (typed input, scroll, open menus) resetting, and a new document request in the Network tab.

**Q2.**
- `/projects/new` → `<NewProject />`. The static `new` is more specific than `:projectId`, so route **ranking** picks it.
- `/projects/42` → `<ProjectLayout />` with `<ProjectOverview />` in its `<Outlet />` (the index route).
- `/projects/42/tasks` → `<ProjectLayout />` with `<TaskList />` in its `<Outlet />`.

**Q3.** `useParams()` returns **strings**. `p.id === projectId` compares a number to a string (`3 === "3"` is `false`), so `find` never matches. Fix: `Number(projectId)` (validate that it's a positive integer, and treat invalid values as not found), or compare as strings consistently.

**Q4.** The empty dependency array `[]` means the effect only runs on mount. Navigating from `/projects/1` to `/projects/2` **re-uses** the same component instance with a new `projectId`, so nothing re-fetches. Fix: depend on `[projectId]`. The second bug: with no `AbortController` cleanup, two fast navigations create a **race**: project 1 (slow) can respond after project 2 and overwrite it. Fix: create a controller in the effect, pass its `signal` to the request, and `return () => controller.abort()` (ignoring `AbortError`).

**Q5.** The project is created on the server, but the user **stays on the form**. `redirect(...)` only *creates* a `Response`. Because the action doesn't `return` it, the action resolves with `undefined` and no navigation happens (the router then revalidates the current page's loaders). Fix: `return redirect(`/projects/${project.id}`);`. (It also lacks error handling, so an API 400 would throw and show the error boundary. Return `{ error }` for expected failures.)

### Model solution: Task Filters

```ts
// src/lib/parse.ts (add)
export type TaskFilter = "all" | "open" | "done";

export function parseTaskFilter(v: string | null): TaskFilter {
  return v === "open" || v === "done" ? v : "all";
}
```

```ts
// src/loaders.ts
import { parseId, parseTaskFilter } from "./lib/parse";

export async function tasksLoader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.projectId);
  const filter = parseTaskFilter(new URL(request.url).searchParams.get("done"));
  const tasks = await projectsApi.tasks(
    id,
    { done: filter === "all" ? undefined : filter === "done" },
    request.signal
  );
  return { tasks, filter };
}
```

```tsx
// src/pages/TaskList.tsx
import { Link, useLoaderData, useNavigation } from "react-router";
import type { tasksLoader } from "../loaders";
import type { TaskFilter } from "../lib/parse";

const FILTERS: { value: TaskFilter; label: string; to: string }[] = [
  { value: "all", label: "All", to: "?" },
  { value: "open", label: "Open", to: "?done=open" },
  { value: "done", label: "Done", to: "?done=done" },
];

export default function TaskList() {
  const { tasks, filter } = useLoaderData() as Awaited<ReturnType<typeof tasksLoader>>;
  const navigation = useNavigation();
  const loading = navigation.state === "loading";

  return (
    <section>
      <nav className="flex gap-3" aria-label="Task filter">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            to={f.to}
            aria-current={filter === f.value ? "page" : undefined}
            className={filter === f.value ? "font-semibold underline" : "text-slate-500"}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <div className={loading ? "mt-3 opacity-50 transition-opacity" : "mt-3"}>
        {tasks.length === 0 ? (
          <p className="text-slate-500">No {filter === "all" ? "" : `${filter} `}tasks.</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id}>{t.done ? "✅" : "⬜"} {t.title}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

**Talking points for review:**
- **Why not `NavLink`?** `NavLink` decides "active" by comparing the **pathname** only, so all three filter links (same path, different query) would look active. The current filter comes from the loader (parsed from the URL), and `aria-current` conveys it to assistive technology too, so it isn't communicated by styling alone.
- `parseTaskFilter` is the single place that decides what a valid value is, so `?done=banana` quietly becomes `all`.
- The loader reads the URL and the **router re-runs it when only the query string changes**. There's no `useEffect` and no manual cancellation, because `request.signal` handles it.
- `useNavigation().state === "loading"` covers the in-between moment while the next filter's data is fetched, and the old list stays visible (dimmed) instead of flashing blank.
- The relative `to="?"` clears the query string while staying on the same path.
- Task data is filtered on the **server** (`?done=`), which matters for large lists, and the empty state names the filter ("No open tasks.").

> **Version note for the instructor:** before class verify the installed versions of React Router (v7 import locations, `react-router/dom`, `errorElement` vs `ErrorBoundary`, loader typing), Vite and its `react-ts` template `tsconfig`/ESLint settings (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `react-refresh/only-export-components`, the hooks lint rules), Tailwind v4 setup, and Express 5 plus `@types/express` behavior (`req.body` when absent, handler return types). SPA-fallback configuration varies by host, so check your hosting provider's current docs. All code otherwise uses only `useState`, `useEffect`, and the standard `fetch` and `AbortController` APIs.
