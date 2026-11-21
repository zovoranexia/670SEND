import { Body, Controller, Get, HttpCode, Patch, Post, Req, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { LOCALES } from '@670send/types';
import { pinSchema, tlPhoneSchema } from '@670send/validation';
import { Authenticated, CurrentActor, Public } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../rbac/actor';
import { AuthService, toPublicUser } from './auth.service';

/** Marks a route for the stricter per-IP login throttle (see AppModule ThrottlerModule). */
export const AUTH_THROTTLE = 'authThrottle';
const AuthThrottle = () => SetMetadata(AUTH_THROTTLE, true);

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});
const pinLoginSchema = z.object({
  phone: tlPhoneSchema,
  // Not pinSchema: login must accept whatever PIN is stored (even a legacy weak one).
  pin: z.string().regex(/^\d{6}$/, { message: 'errors.validation.pin' }),
});
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(256) });
const logoutSchema = z.object({ refreshToken: z.string().min(20).max(256).optional() });
const languageSchema = z.object({ lang: z.enum(LOCALES) });
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z
      .string()
      .min(12, { message: 'errors.validation.password' })
      .max(128)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'errors.validation.password' }),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'errors.validation.password', path: ['newPassword'] });
const changePinSchema = z.object({ currentPin: z.string().regex(/^\d{6}$/).optional(), newPin: pinSchema });

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent')?.slice(0, 300) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @AuthThrottle()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request) {
    return this.auth.loginWithPassword(body.email, body.password, meta(req));
  }

  @Public()
  @AuthThrottle()
  @Post('login/pin')
  @HttpCode(200)
  loginPin(@Body(new ZodValidationPipe(pinLoginSchema)) body: z.infer<typeof pinLoginSchema>, @Req() req: Request) {
    return this.auth.loginWithPin(body.phone, body.pin, meta(req));
  }

  @Public()
  @AuthThrottle()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @Authenticated()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(logoutSchema)) body: z.infer<typeof logoutSchema>,
  ): Promise<void> {
    await this.auth.logout(actor, body.refreshToken);
  }

  @Authenticated()
  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return toPublicUser(actor);
  }

  @Authenticated()
  @Patch('me/language')
  setLanguage(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(languageSchema)) body: z.infer<typeof languageSchema>) {
    return this.auth.setLanguage(actor, body.lang);
  }

  @Authenticated()
  @AuthThrottle()
  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ): Promise<void> {
    await this.auth.changePassword(actor, body.currentPassword, body.newPassword);
  }

  @Authenticated()
  @AuthThrottle()
  @Post('pin/change')
  @HttpCode(204)
  async changePin(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(changePinSchema)) body: z.infer<typeof changePinSchema>,
  ): Promise<void> {
    await this.auth.changePin(actor, body.currentPin, body.newPin);
  }
}
