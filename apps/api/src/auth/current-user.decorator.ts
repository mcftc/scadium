import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthContext } from './jwt-auth.guard';

// Re-export for controllers that want to type the @CurrentUser() param.
export type AuthContextLike = AuthContext;

/**
 * Param decorator that surfaces the AuthContext attached by JwtAuthGuard.
 * Usage: `async foo(@CurrentUser() user: AuthContext) { … }`
 *
 * Throws if the route is missing JwtAuthGuard — it's a programming error
 * to reach here without an authenticated request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    if (!req.auth) {
      throw new Error('CurrentUser used on an unauthenticated route (missing JwtAuthGuard?)');
    }
    return req.auth;
  },
);
