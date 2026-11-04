import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

type Source = "body" | "params" | "query";

export const validate =
  (schema: ZodType, source: Source = "body") =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (source === "query") {
      // Express 5 exposes req.query as a getter, so shadow it with the parsed value.
      Object.defineProperty(req, "query", {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req[source] = result.data; // the cleaned, validated data
    }
    next();
  };
