import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuctionsModule } from '../auctions/auctions.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { LotsModule } from '../lots/lots.module.js';
import { UsersModule } from '../users/users.module.js';
import { BidsModule } from '../bids/bids.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER } from '@nestjs/core';
import { PrismaExceptionFilter } from '../common/prisma-exception.filter.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    AuctionsModule,
    LotsModule,
    BidsModule,
    WalletsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule {}
