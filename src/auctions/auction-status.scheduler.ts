import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuctionsService } from './auctions.service.js';

@Injectable()
export class AuctionStatusScheduler {
  private readonly logger = new Logger(AuctionStatusScheduler.name);
  private isRunning = false;

  constructor(private readonly auctionsService: AuctionsService) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async updateStatuses() {
    if (this.isRunning) return;

    this.isRunning = true;

    try {
      const { activated, finished } =
        await this.auctionsService.updateScheduledStatuses();

      if (activated > 0 || finished > 0) {
        this.logger.log(
          `Status de leilões atualizado: ${activated} ativado(s), ${finished} encerrado(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Falha ao atualizar os status dos leilões pelos horários programados.',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
