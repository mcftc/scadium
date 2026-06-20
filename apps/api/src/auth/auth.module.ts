import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SiwsService } from './siws.service';
import { PrivyService } from './privy.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/** Minimum acceptable JWT signing secret length. A short/guessable secret is as
 * forgeable as a public one. */
export const MIN_JWT_SECRET_BYTES = 32;

/**
 * Fail-closed JWT options factory (#33). There is NO dev fallback: if
 * `JWT_SECRET` is unset/empty or shorter than 32 bytes the factory throws,
 * which aborts Nest bootstrap. A publicly-known or weak secret would let anyone
 * forge an admin token and ban users / read KPIs — account-takeover severity for
 * a money-handling casino. Exported so it can be unit-tested directly.
 */
export function jwtModuleOptions(config: ConfigService): JwtModuleOptions {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || Buffer.byteLength(secret, 'utf8') < MIN_JWT_SECRET_BYTES) {
    throw new Error('JWT_SECRET must be set to a value of at least 32 bytes');
  }
  return {
    secret,
    signOptions: {
      expiresIn: config.get<string>('JWT_ACCESS_TTL') ?? '15m',
    },
  };
}

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: jwtModuleOptions,
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SiwsService, PrivyService, JwtAuthGuard],
  exports: [AuthService, SiwsService, PrivyService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
