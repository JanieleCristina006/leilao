import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { AuctionStatus, LotStatus } from '../../generated/prisma/enums.js';
import { serializable } from '../common/serializable.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

@Injectable()
export class AuctionsService {
  constructor(private readonly prisma: PrismaService) {}

  async updateScheduledStatuses() {
    const now = new Date();

    const activated = await this.prisma.auction.updateMany({
      where: {
        status: { in: [AuctionStatus.DRAFT, AuctionStatus.SCHEDULED] },
        startsAt: { lte: now },
      },
      data: { status: AuctionStatus.ACTIVE },
    });

    const finished = await serializable(this.prisma, (tx) =>
      tx.auction.updateMany({
        where: {
          status: {
            in: [
              AuctionStatus.DRAFT,
              AuctionStatus.SCHEDULED,
              AuctionStatus.ACTIVE,
            ],
          },
          endsAt: { lte: now },
          lots: {
            none: {
              status: { in: [LotStatus.AVAILABLE, LotStatus.IN_AUCTION] },
            },
          },
        },
        data: { status: AuctionStatus.FINISHED },
      }),
    );

    return { activated: activated.count, finished: finished.count };
  }

  async create(auctioneerId: string, createAuctionDto: CreateAuctionDto) {
    const startsAt = new Date(createAuctionDto.startsAt);
    const endsAt = new Date(createAuctionDto.endsAt);

    this.validateAuctionPeriod(startsAt, endsAt);
    if (startsAt < new Date())
      throw new BadRequestException('O início do leilão deve estar no futuro.');
    if (
      createAuctionDto.status !== undefined &&
      !(
        [AuctionStatus.DRAFT, AuctionStatus.SCHEDULED] as AuctionStatus[]
      ).includes(createAuctionDto.status)
    ) {
      throw new BadRequestException('Crie o leilão como DRAFT ou SCHEDULED.');
    }

    try {
      const data: Prisma.AuctionCreateInput = {
        title: createAuctionDto.title,
        startsAt,
        endsAt,
        auctioneer: { connect: { id: auctioneerId } },
      };

      if (createAuctionDto.description !== undefined) {
        data.description = createAuctionDto.description;
      }
      if (createAuctionDto.status !== undefined) {
        data.status = createAuctionDto.status;
      }

      const createAuction = await this.prisma.auction.create({
        data,
      });

      return {
        message: 'Leilão criado com sucesso!',
        createAuction,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAll() {
    return this.prisma.auction.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  findMine(auctioneerId: string) {
    return this.prisma.auction.findMany({
      where: { auctioneerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
    });

    if (!auction) {
      throw new NotFoundException('Leilão não encontrado.');
    }

    return auction;
  }

  async update(
    id: string,
    auctioneerId: string,
    updateAuctionDto: UpdateAuctionDto,
  ) {
    try {
      const updateAuction = await serializable(this.prisma, async (tx) => {
        const currentAuction = await tx.auction.findFirst({
          where: { id, auctioneerId },
        });

        if (!currentAuction) {
          throw new NotFoundException('Leilão não encontrado.');
        }

        if (
          currentAuction.status === AuctionStatus.FINISHED ||
          currentAuction.status === AuctionStatus.CANCELLED
        ) {
          throw new ConflictException(
            'Leilões encerrados não podem ser alterados.',
          );
        }
        const hasStarted =
          currentAuction.startsAt <= new Date() ||
          currentAuction.status === AuctionStatus.ACTIVE;
        if (
          hasStarted &&
          (updateAuctionDto.startsAt !== undefined ||
            updateAuctionDto.endsAt !== undefined)
        ) {
          throw new ConflictException(
            'Não é possível alterar o período de um leilão iniciado.',
          );
        }
        if (updateAuctionDto.status !== undefined) {
          const allowed: AuctionStatus[] = hasStarted
            ? [AuctionStatus.CANCELLED]
            : [
                AuctionStatus.DRAFT,
                AuctionStatus.SCHEDULED,
                AuctionStatus.CANCELLED,
              ];
          if (
            updateAuctionDto.status !== currentAuction.status &&
            !allowed.includes(updateAuctionDto.status)
          ) {
            throw new ConflictException(
              'Transição de estado não permitida. O início e o fechamento são automáticos.',
            );
          }
        }
        if (updateAuctionDto.status === AuctionStatus.CANCELLED) {
          const bids = await tx.bid.count({
            where: { lot: { auctionId: id } },
          });
          if (bids > 0)
            throw new ConflictException(
              'Não é possível cancelar um leilão com lances.',
            );
          await tx.lot.updateMany({
            where: {
              auctionId: id,
              status: { in: [LotStatus.AVAILABLE, LotStatus.IN_AUCTION] },
            },
            data: { status: LotStatus.CANCELLED },
          });
        }

        const startsAt =
          updateAuctionDto.startsAt !== undefined
            ? new Date(updateAuctionDto.startsAt)
            : currentAuction.startsAt;
        const endsAt =
          updateAuctionDto.endsAt !== undefined
            ? new Date(updateAuctionDto.endsAt)
            : currentAuction.endsAt;

        this.validateAuctionPeriod(startsAt, endsAt);
        if (!hasStarted && startsAt < new Date())
          throw new BadRequestException(
            'O início do leilão deve estar no futuro.',
          );

        const data: Prisma.AuctionUpdateInput = {};

        if (updateAuctionDto.title !== undefined) {
          data.title = updateAuctionDto.title;
        }
        if (updateAuctionDto.description !== undefined) {
          data.description = updateAuctionDto.description;
        }
        if (updateAuctionDto.status !== undefined) {
          data.status = updateAuctionDto.status;
        }
        if (updateAuctionDto.startsAt !== undefined) {
          data.startsAt = startsAt;
        }
        if (updateAuctionDto.endsAt !== undefined) {
          data.endsAt = endsAt;
        }

        const updatedAuction = await tx.auction.update({
          where: { id, auctioneerId },
          data,
        });

        if (updateAuctionDto.endsAt !== undefined) {
          // Atualiza os lotes que ainda usavam o encerramento original.
          // Lotes já prorrogados mantêm o próprio horário final.
          await tx.lot.updateMany({
            where: { auctionId: id, endsAt: currentAuction.endsAt },
            data: { endsAt },
          });
        }

        return updatedAuction;
      });

      return {
        message: 'Leilão atualizado com sucesso!',
        updateAuction,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: string, auctioneerId: string) {
    try {
      const removeAuction = await serializable(this.prisma, async (tx) => {
        const auction = await tx.auction.findFirst({
          where: { id, auctioneerId },
        });
        if (!auction) throw new NotFoundException('Leilão não encontrado.');
        if (
          auction.startsAt <= new Date() ||
          !(
            [AuctionStatus.DRAFT, AuctionStatus.SCHEDULED] as AuctionStatus[]
          ).includes(auction.status)
        ) {
          throw new ConflictException(
            'Somente leilões não iniciados podem ser removidos.',
          );
        }
        return tx.auction.delete({
          where: { id, auctioneerId },
        });
      });

      return {
        message: 'Leilão removido com sucesso!',
        removeAuction,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private validateAuctionPeriod(startsAt: Date, endsAt: Date): void {
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      startsAt >= endsAt
    ) {
      throw new BadRequestException(
        'A data de encerramento deve ser posterior à data de início.',
      );
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2025':
          throw new NotFoundException('Leilão não encontrado.');
        case 'P2003':
        case 'P2014':
          throw new ConflictException(
            'Não é possível remover o leilão porque existem lotes vinculados a ele.',
          );
      }
    }

    throw error;
  }
}
