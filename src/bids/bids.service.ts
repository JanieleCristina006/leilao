import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuctionStatus,
  BidStatus,
  LotStatus,
  WalletTransactionType,
} from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBidDto } from './dto/create-bid.dto.js';
import { BidsGateway } from './bids.gateway.js';
import { createBidAuditHash } from './bid-audit.utils.js';

const MAX_TRANSACTION_ATTEMPTS = 5;
const ANTI_SNIPING_WINDOW_MS = 2 * 60 * 1000;
const ANTI_SNIPING_EXTENSION_MS = 2 * 60 * 1000;

@Injectable()
export class BidsService {
  private readonly logger = new Logger(BidsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bidsGateway: BidsGateway,
  ) {}

  async create(bidderId: string, createBidDto: CreateBidDto) {
    const amount = new Prisma.Decimal(createBidDto.amount);

    if (amount.lte(0)) {
      throw new BadRequestException(
        'O valor do lance precisa ser maior que zero.',
      );
    }

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      let result: {
        bid: {
          id: string;
          lotId: string;
          bidderId: string;
          amount: Prisma.Decimal;
          status: BidStatus;
          createdAt: Date;
        };
        previousLeaderId: string | null;
        endsAt: Date;
      };

      try {
        result = await this.prisma.$transaction(
          async (tx) => {
            const lot = await tx.lot.findUnique({
              where: { id: createBidDto.lotId },
              include: {
                auction: {
                  select: {
                    status: true,
                    startsAt: true,
                    auctioneerId: true,
                  },
                },
              },
            });

            if (!lot) {
              throw new NotFoundException('Lote não encontrado.');
            }

            if (!lot.auction.auctioneerId) {
              throw new ConflictException(
                'Este leilão não possui um leiloeiro responsável para receber o pagamento.',
              );
            }

            const now = new Date();
            const auctionIsOpen =
              lot.auction.status === AuctionStatus.ACTIVE &&
              now >= lot.auction.startsAt &&
              now < lot.endsAt;

            if (!auctionIsOpen) {
              throw new ConflictException(
                'Este leilão não está aceitando lances neste momento.',
              );
            }

            if (
              lot.status !== LotStatus.AVAILABLE &&
              lot.status !== LotStatus.IN_AUCTION
            ) {
              throw new ConflictException(
                'Este lote não está disponível para receber lances.',
              );
            }

            const currentLeader = await tx.bid.findFirst({
              where: { lotId: lot.id, status: BidStatus.ACCEPTED },
              orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
              select: { id: true, bidderId: true, amount: true },
            });

            if (currentLeader?.bidderId === bidderId) {
              throw new BadRequestException(
                'Você já está liderando este lote e não pode cobrir o próprio lance.',
              );
            }

            const minimumAmount = currentLeader
              ? currentLeader.amount.plus(lot.minimumIncrement)
              : lot.startingBid;

            if (amount.lt(minimumAmount)) {
              throw new BadRequestException(
                `O lance mínimo para este lote é ${minimumAmount.toFixed(2)}.`,
              );
            }

            const bidderWallet = await tx.wallet.findUnique({
              where: { profileId: bidderId },
              select: { id: true },
            });

            if (!bidderWallet) {
              throw new UnprocessableEntityException(
                'Este usuário ainda não possui uma carteira.',
              );
            }

            const reserveBidderBalance = await tx.wallet.updateMany({
              where: {
                id: bidderWallet.id,
                availableBalance: { gte: amount },
              },
              data: {
                availableBalance: { decrement: amount },
                committedBalance: { increment: amount },
              },
            });

            if (reserveBidderBalance.count !== 1) {
              throw new BadRequestException(
                'Saldo disponível insuficiente para cobrir este lance.',
              );
            }

            const bid = await tx.bid.create({
              data: {
                lotId: lot.id,
                bidderId,
                amount,
                status: BidStatus.ACCEPTED,
              },
              select: {
                id: true,
                lotId: true,
                bidderId: true,
                amount: true,
                status: true,
                createdAt: true,
              },
            });

            const auditSequence = lot.bidAuditCount + 1;
            const auditHash = createBidAuditHash({
              id: bid.id,
              lotId: bid.lotId,
              bidderId: bid.bidderId,
              amount: bid.amount.toFixed(2),
              status: bid.status,
              createdAt: bid.createdAt,
              sequence: auditSequence,
              previousHash: lot.bidAuditHead,
            });

            await tx.bid.update({
              where: { id: bid.id },
              data: {
                auditSequence,
                auditPreviousHash: lot.bidAuditHead,
                auditHash,
              },
            });

            await tx.walletTransaction.create({
              data: {
                walletId: bidderWallet.id,
                type: WalletTransactionType.BID_RESERVATION,
                amount,
                description: `Reserva do lance ${bid.id}`,
                referenceId: bid.id,
              },
            });

            if (currentLeader) {
              const leaderWallet = await tx.wallet.findUnique({
                where: { profileId: currentLeader.bidderId },
                select: { id: true },
              });

              if (!leaderWallet) {
                throw new ConflictException(
                  'A carteira do líder atual não foi encontrada.',
                );
              }

              const releasePreviousBid = await tx.wallet.updateMany({
                where: {
                  id: leaderWallet.id,
                  committedBalance: { gte: currentLeader.amount },
                },
                data: {
                  committedBalance: { decrement: currentLeader.amount },
                  availableBalance: { increment: currentLeader.amount },
                },
              });

              if (releasePreviousBid.count !== 1) {
                throw new ConflictException(
                  'Não foi possível liberar a reserva do lance anterior.',
                );
              }

              await tx.walletTransaction.create({
                data: {
                  walletId: leaderWallet.id,
                  type: WalletTransactionType.BID_RELEASE,
                  amount: currentLeader.amount,
                  description: `Liberação do lance superado ${currentLeader.id}`,
                  referenceId: currentLeader.id,
                },
              });
            }

            const endsAt = new Date(lot.endsAt);
            const isInAntiSnipingWindow =
              lot.endsAt.getTime() - now.getTime() <= ANTI_SNIPING_WINDOW_MS;

            if (isInAntiSnipingWindow) {
              endsAt.setTime(endsAt.getTime() + ANTI_SNIPING_EXTENSION_MS);
            }

            await tx.lot.update({
              where: { id: lot.id },
              data: {
                currentBid: amount,
                status: LotStatus.IN_AUCTION,
                bidAuditCount: auditSequence,
                bidAuditHead: auditHash,
                ...(isInAntiSnipingWindow && { endsAt }),
              },
            });

            return {
              bid,
              previousLeaderId: currentLeader?.bidderId ?? null,
              endsAt,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const isSerializationConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';

        if (isSerializationConflict && attempt < MAX_TRANSACTION_ATTEMPTS) {
          continue;
        }

        if (isSerializationConflict) {
          throw new ConflictException(
            'Outro lance foi registrado ao mesmo tempo. Tente novamente.',
          );
        }

        throw error;
      }

      try {
        this.bidsGateway.publishBidAccepted({
          lotId: result.bid.lotId,
          bidId: result.bid.id,
          bidderId: result.bid.bidderId,
          previousLeaderId: result.previousLeaderId,
          amount: result.bid.amount.toFixed(2),
          createdAt: result.bid.createdAt,
          endsAt: result.endsAt,
        });
      } catch (error) {
        // O lance já foi confirmado no banco. Uma falha no socket não deve
        // informar ao usuário que o lance falhou nem tentar registrá-lo de novo.
        this.logger.error(
          'O lance foi salvo, mas não foi possível avisar a sala ao vivo.',
          error instanceof Error ? error.stack : String(error),
        );
      }

      return result.bid;
    }

    throw new ConflictException(
      'Não foi possível registrar o lance. Tente novamente.',
    );
  }

  async closeExpiredLots() {
    const now = new Date();
    const expiredLots = await this.prisma.lot.findMany({
      where: {
        status: { in: [LotStatus.AVAILABLE, LotStatus.IN_AUCTION] },
        OR: [
          {
            endsAt: { lte: now },
            auction: { is: { status: AuctionStatus.ACTIVE } },
          },
          { auction: { is: { status: AuctionStatus.FINISHED } } },
        ],
      },
      orderBy: { endsAt: 'asc' },
      take: 100,
      select: { id: true },
    });

    let closedCount = 0;

    for (const { id } of expiredLots) {
      try {
        const result = await this.closeLot(id);
        if (!result) continue;

        closedCount += 1;

        try {
          this.bidsGateway.publishLotClosed(result);
        } catch (error) {
          this.logger.error(
            `O lote ${id} foi liquidado, mas não foi possível notificar a sala ao vivo.`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      } catch (error) {
        this.logger.error(
          `Não foi possível liquidar o lote ${id}.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return closedCount;
  }

  private closeLot(lotId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const lot = await tx.lot.findUnique({
          where: { id: lotId },
          include: {
            auction: {
              select: {
                id: true,
                status: true,
                auctioneerId: true,
                title: true,
              },
            },
          },
        });

        if (
          !lot ||
          (lot.status !== LotStatus.AVAILABLE &&
            lot.status !== LotStatus.IN_AUCTION)
        ) {
          return null;
        }

        const now = new Date();
        const auctionWasFinished =
          lot.auction.status === AuctionStatus.FINISHED;
        const lotDeadlinePassed =
          lot.auction.status === AuctionStatus.ACTIVE && lot.endsAt <= now;

        if (!auctionWasFinished && !lotDeadlinePassed) return null;

        const winner = await tx.bid.findFirst({
          where: { lotId: lot.id, status: BidStatus.ACCEPTED },
          orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
          select: { bidderId: true, amount: true },
        });
        const finalAmount = winner?.amount ?? new Prisma.Decimal(0);

        if (winner && !lot.auction.auctioneerId) {
          throw new ConflictException(
            'Não é possível liquidar o lote porque o leilão não tem leiloeiro vinculado.',
          );
        }

        const totalBidCount = await tx.bid.count({ where: { lotId: lot.id } });

        const receipt = await tx.auctionReceipt.create({
          data: {
            lotId: lot.id,
            winnerId: winner?.bidderId ?? null,
            finalAmount,
            result: winner ? LotStatus.SOLD : LotStatus.UNSOLD,
            lotTitle: lot.title,
            lotDescription: lot.description,
            lotImageUrl: lot.imageUrl,
            startingBid: lot.startingBid,
            auctionTitle: lot.auction.title,
            bidHistoryHash: lot.bidAuditHead,
            bidCount: totalBidCount,
            bidAuditCount: lot.bidAuditCount,
          },
          select: { id: true },
        });

        if (winner && lot.auction.auctioneerId) {
          const winnerWallet = await tx.wallet.findUnique({
            where: { profileId: winner.bidderId },
            select: { id: true },
          });

          if (!winnerWallet) {
            throw new ConflictException(
              'A carteira do vencedor não foi encontrada.',
            );
          }

          const debitWinner = await tx.wallet.updateMany({
            where: {
              id: winnerWallet.id,
              committedBalance: { gte: winner.amount },
            },
            data: { committedBalance: { decrement: winner.amount } },
          });

          if (debitWinner.count !== 1) {
            throw new ConflictException(
              'O saldo comprometido do vencedor não cobre o valor final do lote.',
            );
          }

          const auctioneerWallet = await tx.wallet.upsert({
            where: { profileId: lot.auction.auctioneerId },
            create: {
              profileId: lot.auction.auctioneerId,
              availableBalance: winner.amount,
            },
            update: {
              availableBalance: { increment: winner.amount },
            },
            select: { id: true },
          });

          await tx.walletTransaction.createMany({
            data: [
              {
                walletId: winnerWallet.id,
                type: WalletTransactionType.AUCTION_PAYMENT,
                amount: winner.amount,
                description: `Pagamento do lote ${lot.id}`,
                referenceId: receipt.id,
              },
              {
                walletId: auctioneerWallet.id,
                type: WalletTransactionType.AUCTION_EARNING,
                amount: winner.amount,
                description: `Recebimento do lote ${lot.id}`,
                referenceId: receipt.id,
              },
            ],
          });
        }

        const status = winner ? LotStatus.SOLD : LotStatus.UNSOLD;
        await tx.lot.update({
          where: { id: lot.id },
          data: { status },
        });

        const openLots = await tx.lot.count({
          where: {
            auctionId: lot.auction.id,
            status: { in: [LotStatus.AVAILABLE, LotStatus.IN_AUCTION] },
          },
        });

        if (openLots === 0 && lot.auction.status === AuctionStatus.ACTIVE) {
          await tx.auction.updateMany({
            where: { id: lot.auction.id, status: AuctionStatus.ACTIVE },
            data: { status: AuctionStatus.FINISHED },
          });
        }

        return {
          lotId: lot.id,
          status,
          finalAmount: finalAmount.toFixed(2),
          winnerId: winner?.bidderId ?? null,
          closedAt: now,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
