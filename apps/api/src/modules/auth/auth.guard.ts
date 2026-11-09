import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Permission } from '@autoapply/shared';
import { API_TOKEN_SCOPE, IS_PUBLIC, PERMISSIONS_KEY, type AuthedRequest } from '../../common/core';
import { AuthService, SESSION_COOKIE } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: resolves the caller from the session cookie (browser) or a
 * personal API token (extension), enforces CSRF on cookie-authenticated
 * mutations, API-token scopes and RBAC permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['x-request-id'];
    req.requestId = typeof header === 'string' && /^[\w-]{6,64}$/.test(header) ? header : randomUUID();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null;
    const cookie = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;

    if (bearer) {
      const a = await this.auth.resolveApiToken(bearer);
      if (!a) throw new HttpException({ code: 'UNAUTHENTICATED', message: 'Invalid or revoked API token' }, HttpStatus.UNAUTHORIZED);
      const scope = this.reflector.getAllAndOverride<string>(API_TOKEN_SCOPE, targets);
      if (!isPublic && (!scope || !a.apiTokenScopes.includes(scope))) {
        throw new HttpException({ code: 'FORBIDDEN', message: 'This endpoint is not available to API tokens with your scopes' }, HttpStatus.FORBIDDEN);
      }
      req.auth = a;
    } else if (cookie) {
      const s = await this.auth.resolveSession(cookie);
      if (s) {
        if (!SAFE_METHODS.has(req.method) && !this.auth.checkCsrf(s.csrfToken, req.headers['x-csrf-token'] as string | undefined)) {
          throw new HttpException({ code: 'CSRF', message: 'Missing or invalid CSRF token' }, HttpStatus.FORBIDDEN);
        }
        req.auth = s.ctx;
      }
    }

    if (isPublic) return true;
    if (!req.auth) throw new HttpException({ code: 'UNAUTHENTICATED', message: 'Please sign in' }, HttpStatus.UNAUTHORIZED);
    const perms = this.reflector.getAllAndMerge<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = perms.filter((p) => !req.auth!.permissions.has(p));
    if (missing.length) throw new HttpException({ code: 'FORBIDDEN', message: 'You do not have permission to perform this action' }, HttpStatus.FORBIDDEN);
    return true;
  }
}
