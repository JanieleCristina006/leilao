import {
  Injectable,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import { AuctionStatus, LotStatus } from '../../generated/prisma/enums.js';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { createBidAuditHash } from '../bids/bid-audit.utils.js';

@Injectable()
export class LotsService {
  constructor(private readonly prisma: PrismaService) {}

  async searchArtworks(query: string) {
    if (!query || !query.trim()) {
      throw new BadRequestException(
        'Informe o nome da obra ou artista para pesquisar.',
      );
    }

    const url = new URL('https://api.artic.edu/api/v1/artworks/search');

    url.searchParams.set('q', query.trim());
    url.searchParams.set('limit', '12');
    url.searchParams.set(
      'fields',
      'id,title,artist_display,date_display,medium_display,image_id',
    );

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'AIC-User-Agent': `verzel-leiloes (${process.env.AIC_USER_EMAIL})`,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        console.error('Status da API externa:', response.status);

        throw new ServiceUnavailableException(
          `A API externa retornou o status ${response.status}.`,
        );
      }

      const result = await response.json();

      if (!Array.isArray(result.data)) {
        throw new ServiceUnavailableException(
          'Resposta inesperada da API externa.',
        );
      }

      return result.data
        .filter((artwork: any) => artwork.image_id)
        .map((artwork: any) => ({
          externalId: String(artwork.id),
          title: artwork.title,
          artist: artwork.artist_display,
          date: artwork.date_display,
          medium: artwork.medium_display,
          imageUrl: `${result.config.iiif_url}/${artwork.image_id}/full/843,/0/default.jpg`,
        }));
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Não foi possível consultar a API de obras de arte. Tente novamente em instantes.',
      );
    }
  }

  async create(auctioneerId: string, createLotDto: CreateLotDto) {
    const auction = await this.prisma.auction.findFirst({
      where: {
        id: createLotDto.auctionId,
        auctioneerId,
      },
      select: { id: true, endsAt: true },
    });

    if (!auction) {
      throw new NotFoundException('Leilão não encontrado.');
    }

    return this.prisma.lot.create({
      data: {
        auctionId: auction.id,
        endsAt: auction.endsAt,
        title: createLotDto.title,
        description: createLotDto.description,
        imageUrl: createLotDto.imageUrl,
        externalId: createLotDto.externalId,
        startingBid: createLotDto.startingBid,
        ...(createLotDto.minimumIncrement !== undefined && {
          minimumIncrement: createLotDto.minimumIncrement,
        }),
      },
    });
  }

  findAll() {
    return this.prisma.lot.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  findMine(auctioneerId: string) {
    return this.prisma.lot.findMany({
      where: {
        auction: { is: { auctioneerId } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
    });

    if (!lot) {
      throw new NotFoundException('Lote não encontrado.');
    }

    return lot;
  }

  async getPublicAudit(id: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        bidAuditHead: true,
        bidAuditCount: true,
        receipt: {
          select: {
            bidHistoryHash: true,
            bidCount: true,
            bidAuditCount: true,
          },
        },
        bids: {
          select: {
            id: true,
            lotId: true,
            bidderId: true,
            amount: true,
            status: true,
            createdAt: true,
            auditSequence: true,
            auditPreviousHash: true,
            auditHash: true,
          },
        },
      },
    });

    if (!lot) {
      throw new NotFoundException('Lote não encontrado.');
    }

    const auditedBids = lot.bids
      .filter(
        (bid) =>
          bid.auditSequence !== null ||
          bid.auditPreviousHash !== null ||
          bid.auditHash !== null,
      )
      .sort(
        (left, right) => (left.auditSequence ?? 0) - (right.auditSequence ?? 0),
      );
    const unauditedBids = lot.bids.filter(
      (bid) =>
        bid.auditSequence === null &&
        bid.auditPreviousHash === null &&
        bid.auditHash === null,
    );

    let tampered = false;
    let expectedSequence = 1;
    let previousHash: string | null = null;

    for (const bid of auditedBids) {
      if (bid.auditSequence === null || bid.auditHash === null) {
        tampered = true;
        continue;
      }

      const expectedHash = createBidAuditHash({
        id: bid.id,
        lotId: bid.lotId,
        bidderId: bid.bidderId,
        amount: bid.amount.toFixed(2),
        status: bid.status,
        createdAt: bid.createdAt,
        sequence: bid.auditSequence,
        previousHash: bid.auditPreviousHash,
      });

      if (
        bid.auditSequence !== expectedSequence ||
        bid.auditPreviousHash !== previousHash ||
        bid.auditHash !== expectedHash
      ) {
        tampered = true;
      }

      expectedSequence = bid.auditSequence + 1;
      previousHash = bid.auditHash;
    }

    if (
      auditedBids.length !== lot.bidAuditCount ||
      previousHash !== lot.bidAuditHead
    ) {
      tampered = true;
    }

    let receiptSnapshotMissing = false;
    if (lot.receipt) {
      if (lot.receipt.bidCount === null || lot.receipt.bidAuditCount === null) {
        receiptSnapshotMissing = true;
      } else if (
        lot.receipt.bidCount !== lot.bids.length ||
        lot.receipt.bidAuditCount !== lot.bidAuditCount ||
        lot.receipt.bidHistoryHash !== lot.bidAuditHead
      ) {
        tampered = true;
      }
    }

    const integrity = tampered
      ? 'TAMPERED'
      : unauditedBids.length > 0 || receiptSnapshotMissing
        ? 'INCOMPLETE'
        : 'INTACT';

    return {
      lotId: lot.id,
      integrity,
      isIntact: integrity === 'INCOMPLETE' ? null : integrity === 'INTACT',
      verifiedBidCount: auditedBids.length,
      unauditedBidCount: unauditedBids.length,
      expectedBidCount: lot.bidAuditCount,
      expectedHead: lot.bidAuditHead,
      events: [...lot.bids]
        .sort((left, right) => {
          const timeOrder =
            left.createdAt.getTime() - right.createdAt.getTime();
          return timeOrder || left.id.localeCompare(right.id);
        })
        .map((bid) => ({
          sequence: bid.auditSequence,
          amount: bid.amount.toFixed(2),
          status: bid.status,
          createdAt: bid.createdAt,
          previousHash: bid.auditPreviousHash,
          hash: bid.auditHash,
          verifiable: bid.auditSequence !== null && bid.auditHash !== null,
        })),
      checkedAt: new Date(),
    };
  }

  async getPublicReceipt(id: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        startingBid: true,
        status: true,
        auction: { select: { id: true, title: true } },
        receipt: {
          select: {
            id: true,
            finalAmount: true,
            issuedAt: true,
            result: true,
            lotTitle: true,
            lotDescription: true,
            lotImageUrl: true,
            startingBid: true,
            auctionTitle: true,
            bidHistoryHash: true,
            bidCount: true,
            bidAuditCount: true,
          },
        },
      },
    });

    if (!lot) {
      throw new NotFoundException('Lote não encontrado.');
    }

    if (!lot.receipt) {
      throw new NotFoundException('O comprovante deste lote ainda não existe.');
    }

    const audit = await this.getPublicAudit(id);

    return {
      receiptId: lot.receipt.id,
      sharePath: `/lots/${lot.id}/receipt`,
      issuedAt: lot.receipt.issuedAt,
      result: lot.receipt.result ?? lot.status,
      finalAmount: lot.receipt.finalAmount.toFixed(2),
      lot: {
        id: lot.id,
        title: lot.receipt.lotTitle ?? lot.title,
        description: lot.receipt.lotDescription ?? lot.description,
        imageUrl: lot.receipt.lotImageUrl ?? lot.imageUrl,
        startingBid: (lot.receipt.startingBid ?? lot.startingBid).toFixed(2),
      },
      auction: {
        id: lot.auction.id,
        title: lot.receipt.auctionTitle ?? lot.auction.title,
      },
      bidAudit: {
        integrity: audit.integrity,
        verifiedBidCount: audit.verifiedBidCount,
        unauditedBidCount: audit.unauditedBidCount,
        bidCountAtReceipt: lot.receipt.bidCount,
        auditedBidCountAtReceipt: lot.receipt.bidAuditCount,
        historyHashAtReceipt: lot.receipt.bidHistoryHash,
        verificationPath: `/lots/${lot.id}/audit`,
      },
    };
  }

  async cancel(id: string, auctioneerId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lot = await tx.lot.findFirst({
            where: { id, auction: { is: { auctioneerId } } },
            select: {
              id: true,
              status: true,
              endsAt: true,
              auctionId: true,
              auction: { select: { status: true } },
            },
          });

          if (!lot) {
            throw new NotFoundException('Lote não encontrado.');
          }

          if (
            (lot.status !== LotStatus.AVAILABLE &&
              lot.status !== LotStatus.IN_AUCTION) ||
            lot.auction.status === AuctionStatus.FINISHED ||
            lot.auction.status === AuctionStatus.CANCELLED ||
            lot.endsAt <= new Date()
          ) {
            throw new ConflictException(
              'Este lote não pode mais ser cancelado.',
            );
          }

          const bidCount = await tx.bid.count({ where: { lotId: lot.id } });
          if (bidCount > 0) {
            throw new ConflictException(
              'Não é possível cancelar um lote que já recebeu lances.',
            );
          }

          const cancelledLot = await tx.lot.update({
            where: { id: lot.id },
            data: { status: LotStatus.CANCELLED, currentBid: null },
          });

          const openLots = await tx.lot.count({
            where: {
              auctionId: lot.auctionId,
              status: { in: [LotStatus.AVAILABLE, LotStatus.IN_AUCTION] },
            },
          });

          if (openLots === 0 && lot.auction.status === AuctionStatus.ACTIVE) {
            await tx.auction.updateMany({
              where: { id: lot.auctionId, status: AuctionStatus.ACTIVE },
              data: { status: AuctionStatus.FINISHED },
            });
          }

          return cancelledLot;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'O lote recebeu uma alteração simultânea. Atualize os dados e tente novamente.',
        );
      }

      throw error;
    }
  }

  async update(id: string, auctioneerId: string, updateLotDto: UpdateLotDto) {
    const data: Prisma.LotUpdateInput = {};

    if (updateLotDto.title !== undefined) data.title = updateLotDto.title;
    if (updateLotDto.description !== undefined) {
      data.description = updateLotDto.description;
    }
    if (updateLotDto.imageUrl !== undefined) {
      data.imageUrl = updateLotDto.imageUrl;
    }
    if (updateLotDto.externalId !== undefined) {
      data.externalId = updateLotDto.externalId;
    }
    if (updateLotDto.startingBid !== undefined) {
      data.startingBid = updateLotDto.startingBid;
    }

    return this.prisma.lot.update({
      where: {
        id,
        auction: { is: { auctioneerId } },
      },
      data,
    });
  }

  async remove(id: string, auctioneerId: string) {
    return this.prisma.lot.delete({
      where: {
        id,
        auction: { is: { auctioneerId } },
      },
    });
  }
}
