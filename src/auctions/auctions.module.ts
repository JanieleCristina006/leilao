import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuctionsService } from './auctions.service';
import { AuctionsController } from './auctions.controller';
import { AuctionStatusScheduler } from './auction-status.scheduler.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionStatusScheduler],
})
export class AuctionsModule {}
