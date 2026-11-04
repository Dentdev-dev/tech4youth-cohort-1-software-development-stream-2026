import { pool } from "../lib/db.ts";
import type { Task } from "./../types/task.ts";

type AdminTaskListFilters = {
  search: string;
  status: string;
};

type TaskRow = Task;

export async function findAllTasks(
  filters: AdminTaskListFilters,
): Promise<Task[]> {
  const condiditions: string[] = [];
  const values: unknown[] = [];

  let paramIndex = 1;

  if (filters.search) {
    condiditions.push(`title ILIKE $${paramIndex}`);
    values.push(`%${filters.search}%`);
    paramIndex++;
  }

  if (filters.status) {
    condiditions.push(`status = $${paramIndex}`);
    values.push(filters.status);
  }

  const whereClause =
    condiditions.length > 0 ? `WHERE ${condiditions.join(" AND ")}` : "";

  const result = await pool.query<TaskRow>(
    `
    SELECT id, title, status, user_id, created_at, updated_at
    FROM support_tasks
    ${whereClause}
    ORDER BY created_at DESC
    `,
    values,
  );

  return result.rows;
}

export async function updateTaskStatus(
  taskId: string,
  status: string,
): Promise<Task | null> {
  const result = await pool.query(
    `
        UPDATE support_tasks
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, title, status, user_id, created_at, updated_at
        `,
    [status, taskId],
  );

  return result.rows[0] ?? null;
}
