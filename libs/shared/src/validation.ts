import { AnyZodObject } from 'zod';
import { Request, Response, NextFunction } from 'express';

export function validateBody(schema: AnyZodObject) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    (req as any).validated = parsed.data;
    next();
  };
}
