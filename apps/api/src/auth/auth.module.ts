import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SiwsService } from './siws.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me';
        // Never ship the dev fallback to production — a known secret means forgeable
        // session tokens. Fail the boot loudly instead of serving with it.
        if (process.env.NODE_ENV === 'production' && secret === 'dev-secret-change-me') {
          throw new Error('JWT_SECRET must be set to a strong value in production');
        }
        return {
          secret,
          signOptions: {
            expiresIn: config.get<string>('JWT_ACCESS_TTL') ?? '15m',
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SiwsService, JwtAuthGuard],
  exports: [AuthService, SiwsService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
