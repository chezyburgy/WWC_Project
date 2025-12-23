import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function jwtMiddleware(required = true) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: 'missing token' });
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid token' });
    }
  };
}
