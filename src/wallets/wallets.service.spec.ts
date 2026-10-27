import { BadRequestException } from '@nestjs/common';
import { WalletTransactionType } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletsService } from './wallets.service.js';

describe('WalletsService', () => {
  const tx = {
    wallet: { findUnique: jest.fn(), update: jest.fn() },
    walletTransaction: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    wallet: { findUnique: jest.fn() },
    walletTransaction: { findMany: jest.fn() },
  };
  const service = new WalletsService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('deposita saldo disponível e registra a movimentação', async () => {
    tx.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
    tx.wallet.update.mockResolvedValue({
      availableBalance: new Prisma.Decimal('50.00'),
      committedBalance: new Prisma.Decimal('20.00'),
    });
    tx.walletTransaction.create.mockResolvedValue({
      id: 'transaction-1',
      type: WalletTransactionType.DEPOSIT,
      amount: new Prisma.Decimal('50.00'),
      description: 'Depósito simulado',
      referenceId: null,
      createdAt: new Date(),
    });

    const result = await service.createDeposit('profile-1', {
      amount: '50.00',
    });

    expect(result.wallet).toEqual({
      availableBalance: '50.00',
      committedBalance: '20.00',
      totalBalance: '70.00',
    });
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wallet-1' },
        data: { availableBalance: { increment: new Prisma.Decimal('50.00') } },
      }),
    );
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: WalletTransactionType.DEPOSIT,
          amount: new Prisma.Decimal('50.00'),
        }),
      }),
    );
    expect(result.transaction.amount).toBe('50.00');
  });

  it('rejeita depósito zero ou negativo', async () => {
    await expect(
      service.createDeposit('profile-1', { amount: '0.00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
