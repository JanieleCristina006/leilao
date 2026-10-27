// src/auth/jwt/jwt-config.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');

        if (!secret) {
          throw new Error('JWT_SECRET não configurado!');
        }

        return {
          secret,
          signOptions: { expiresIn: '15d' as const },
        };
      },
    }),
  ],
  exports: [JwtModule],
})
export class JwtConfigModule {}
