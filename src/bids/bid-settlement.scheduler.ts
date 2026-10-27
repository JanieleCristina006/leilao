import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BidsService } from './bids.service.js';

@Injectable()
export class BidSettlementScheduler {
  private readonly logger = new Logger(BidSettlementScheduler.name);
  private isRunning = false;

  constructor(private readonly bidsService: BidsService) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async closeExpiredLots() {
    if (this.isRunning) return;

    this.isRunning = true;

    try {
      await this.bidsService.closeExpiredLots();
    } catch (error) {
      this.logger.error(
        'Falha ao procurar lotes que precisam ser encerrados.',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
