import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { WalletTransactionType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDepositDto } from './dto/create-deposit.dto.js';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(profileId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { profileId },
      select: { availableBalance: true, committedBalance: true },
    });

    if (!wallet) {
      throw new NotFoundException('Carteira não encontrada.');
    }

    return this.formatBalances(
      wallet.availableBalance,
      wallet.committedBalance,
    );
  }

  async findMyTransactions(profileId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { profileId },
      select: { id: true },
    });

    if (!wallet) {
      throw new NotFoundException('Carteira não encontrada.');
    }

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        amount: true,
        description: true,
        referenceId: true,
        createdAt: true,
      },
    });

    return transactions.map((transaction) => ({
      ...transaction,
      amount: transaction.amount.toFixed(2),
    }));
  }

  async createDeposit(profileId: string, createDepositDto: CreateDepositDto) {
    const amount = new Prisma.Decimal(createDepositDto.amount);

    if (amount.lte(0)) {
      throw new BadRequestException(
        'O valor do depósito precisa ser maior que zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { profileId },
        select: { id: true },
      });

      if (!wallet) {
        throw new NotFoundException('Carteira não encontrada.');
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { availableBalance: { increment: amount } },
        select: { availableBalance: true, committedBalance: true },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEPOSIT,
          amount,
          description: 'Depósito simulado',
        },
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          referenceId: true,
          createdAt: true,
        },
      });

      return {
        wallet: this.formatBalances(
          updatedWallet.availableBalance,
          updatedWallet.committedBalance,
        ),
        transaction: {
          ...transaction,
          amount: transaction.amount.toFixed(2),
        },
      };
    });
  }

  private formatBalances(
    availableBalance: Prisma.Decimal,
    committedBalance: Prisma.Decimal,
  ) {
    return {
      availableBalance: availableBalance.toFixed(2),
      committedBalance: committedBalance.toFixed(2),
      totalBalance: availableBalance.plus(committedBalance).toFixed(2),
    };
  }
}
