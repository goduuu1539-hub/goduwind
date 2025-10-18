export {};

declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      email: string;
    }

    interface Request {
      user?: AuthenticatedUser;
      token?: string;
    }
  }
}
