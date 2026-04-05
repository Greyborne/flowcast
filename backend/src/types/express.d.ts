// Extend Express Request to carry the active account ID, injected by accountMiddleware.
declare namespace Express {
  interface Request {
    accountId: string;
  }
}
