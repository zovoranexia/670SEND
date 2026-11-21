import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  // Secrets/expiry are passed per call from the validated ENV (see TokenService).
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PasswordService, JwtAuthGuard],
  exports: [AuthService, TokenService, PasswordService, JwtAuthGuard],
})
export class AuthModule {}
