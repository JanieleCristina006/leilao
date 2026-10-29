import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { AuctionStatus } from '../../generated/prisma/enums.js';
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
        endsAt: { gt: now },
      },
      data: { status: AuctionStatus.ACTIVE },
    });

    const finished = await this.prisma.auction.updateMany({
      where: {
        status: {
          in: [
            AuctionStatus.DRAFT,
            AuctionStatus.SCHEDULED,
            AuctionStatus.ACTIVE,
          ],
        },
        endsAt: { lte: now },
      },
      data: { status: AuctionStatus.FINISHED },
    });

    return { activated: activated.count, finished: finished.count };
  }

  async create(auctioneerId: string, createAuctionDto: CreateAuctionDto) {
    const startsAt = new Date(createAuctionDto.startsAt);
    const endsAt = new Date(createAuctionDto.endsAt);

    this.validateAuctionPeriod(startsAt, endsAt);

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
    const currentAuction = await this.prisma.auction.findFirst({
      where: { id, auctioneerId },
    });

    if (!currentAuction) {
      throw new NotFoundException('Leilão não encontrado.');
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

    try {
      const updateAuction = await this.prisma.$transaction(async (tx) => {
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
      const removeAuction = await this.prisma.auction.delete({
        where: { id, auctioneerId },
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
