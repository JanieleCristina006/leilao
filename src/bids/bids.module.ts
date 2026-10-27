import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JwtConfigModule } from '../auth/jwt/jwt-config.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BidsController } from './bids.controller.js';
import { BidsGateway } from './bids.gateway.js';
import { BidSettlementScheduler } from './bid-settlement.scheduler.js';
import { BidsService } from './bids.service.js';

@Module({
  imports: [AuthModule, JwtConfigModule, PrismaModule],
  controllers: [BidsController],
  providers: [BidsService, BidsGateway, BidSettlementScheduler],
})
export class BidsModule {}
