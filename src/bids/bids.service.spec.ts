import { BadRequestException } from '@nestjs/common';
import {
  AuctionStatus,
  BidStatus,
  LotStatus,
  WalletTransactionType,
} from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BidsGateway } from './bids.gateway.js';
import { BidsService } from './bids.service.js';

const makeHarness = () => {
  const tx = {
    lot: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    bid: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    walletTransaction: { create: jest.fn(), createMany: jest.fn() },
    auctionReceipt: { create: jest.fn() },
    auction: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    lot: { findMany: jest.fn() },
  };
  const gateway = {
    publishBidAccepted: jest.fn(),
    publishLotClosed: jest.fn(),
  };
  const service = new BidsService(
    prisma as unknown as PrismaService,
    gateway as unknown as BidsGateway,
  );

  return { tx, prisma, gateway, service };
};

const createActiveLot = (overrides: Record<string, unknown> = {}) => ({
  id: 'lot-1',
  auctionId: 'auction-1',
  title: 'Obra de teste',
  description: null,
  imageUrl: null,
  status: LotStatus.AVAILABLE,
  startingBid: new Prisma.Decimal('100.00'),
  minimumIncrement: new Prisma.Decimal('10.00'),
  currentBid: null,
  endsAt: new Date(Date.now() + 10 * 60 * 1000),
  bidAuditCount: 0,
  bidAuditHead: null,
  auction: {
    id: 'auction-1',
    title: 'Leilão de teste',
    status: AuctionStatus.ACTIVE,
    startsAt: new Date(Date.now() - 60 * 1000),
    auctioneerId: 'auctioneer-1',
  },
  ...overrides,
});

describe('BidsService regras de lances e liquidação', () => {
  it('aceita o primeiro lance no valor inicial e reserva o saldo', async () => {
    const { tx, service, gateway } = makeHarness();
    const createdAt = new Date();
    tx.lot.findUnique.mockResolvedValue(createActiveLot());
    tx.bid.findFirst.mockResolvedValue(null);
    tx.wallet.findUnique.mockResolvedValue({ id: 'wallet-bidder' });
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.bid.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'bid-1',
        lotId: data.lotId,
        bidderId: data.bidderId,
        amount: data.amount,
        status: data.status,
        createdAt,
      }),
    );

    const bid = await service.create('bidder-1', {
      lotId: 'lot-1',
      amount: '100.00',
    });

    expect(bid.amount.toFixed(2)).toBe('100.00');
    expect(tx.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'wallet-bidder',
          availableBalance: { gte: expect.any(Prisma.Decimal) },
        }),
        data: {
          availableBalance: { decrement: expect.any(Prisma.Decimal) },
          committedBalance: { increment: expect.any(Prisma.Decimal) },
        },
      }),
    );
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: WalletTransactionType.BID_RESERVATION,
          referenceId: 'bid-1',
        }),
      }),
    );
    expect(gateway.publishBidAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '100.00', lotId: 'lot-1' }),
    );
  });

  it('rejeita um primeiro lance abaixo do valor inicial', async () => {
    const { tx, service } = makeHarness();
    tx.lot.findUnique.mockResolvedValue(createActiveLot());
    tx.bid.findFirst.mockResolvedValue(null);

    await expect(
      service.create('bidder-1', { lotId: 'lot-1', amount: '99.99' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  it('exige o incremento mínimo acima do lance líder', async () => {
    const { tx, service } = makeHarness();
    tx.lot.findUnique.mockResolvedValue(
      createActiveLot({ status: LotStatus.IN_AUCTION }),
    );
    tx.bid.findFirst.mockResolvedValue({
      id: 'bid-existing',
      bidderId: 'bidder-1',
      amount: new Prisma.Decimal('100.00'),
    });

    await expect(
      service.create('bidder-2', { lotId: 'lot-1', amount: '109.99' }),
    ).rejects.toThrow('110.00');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  it('impede o líder atual de cobrir o próprio lance', async () => {
    const { tx, service } = makeHarness();
    tx.lot.findUnique.mockResolvedValue(createActiveLot());
    tx.bid.findFirst.mockResolvedValue({
      id: 'bid-existing',
      bidderId: 'bidder-1',
      amount: new Prisma.Decimal('100.00'),
    });

    await expect(
      service.create('bidder-1', { lotId: 'lot-1', amount: '120.00' }),
    ).rejects.toThrow('não pode cobrir o próprio lance');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  it('rejeita lance sem saldo suficiente', async () => {
    const { tx, service } = makeHarness();
    tx.lot.findUnique.mockResolvedValue(createActiveLot());
    tx.bid.findFirst.mockResolvedValue(null);
    tx.wallet.findUnique.mockResolvedValue({ id: 'wallet-bidder' });
    tx.wallet.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.create('bidder-1', { lotId: 'lot-1', amount: '100.00' }),
    ).rejects.toThrow('Saldo disponível insuficiente');
    expect(tx.bid.create).not.toHaveBeenCalled();
  });

  it('libera a reserva do líder anterior quando outro licitante supera o lance', async () => {
    const { tx, service } = makeHarness();
    tx.lot.findUnique.mockResolvedValue(
      createActiveLot({ status: LotStatus.IN_AUCTION, bidAuditCount: 1 }),
    );
    tx.bid.findFirst.mockResolvedValue({
      id: 'bid-old',
      bidderId: 'bidder-1',
      amount: new Prisma.Decimal('100.00'),
    });
    tx.wallet.findUnique
      .mockResolvedValueOnce({ id: 'wallet-new-bidder' })
      .mockResolvedValueOnce({ id: 'wallet-old-leader' });
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.bid.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'bid-new',
        lotId: data.lotId,
        bidderId: data.bidderId,
        amount: data.amount,
        status: data.status,
        createdAt: new Date(),
      }),
    );

    await service.create('bidder-2', {
      lotId: 'lot-1',
      amount: '110.00',
    });

    expect(tx.wallet.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.wallet.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'wallet-old-leader',
          committedBalance: { gte: new Prisma.Decimal('100.00') },
        }),
      }),
    );
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: WalletTransactionType.BID_RELEASE,
          referenceId: 'bid-old',
        }),
      }),
    );
  });

  it('prorroga o encerramento em dois minutos quando o lance chega na janela final', async () => {
    const { tx, service } = makeHarness();
    const initialEndsAt = new Date(Date.now() + 60 * 1000);
    tx.lot.findUnique.mockResolvedValue(
      createActiveLot({ endsAt: initialEndsAt }),
    );
    tx.bid.findFirst.mockResolvedValue(null);
    tx.wallet.findUnique.mockResolvedValue({ id: 'wallet-bidder' });
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.bid.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'bid-1',
        lotId: data.lotId,
        bidderId: data.bidderId,
        amount: data.amount,
        status: data.status,
        createdAt: new Date(),
      }),
    );

    await service.create('bidder-1', { lotId: 'lot-1', amount: '100.00' });

    const updatedEndsAt = tx.lot.update.mock.calls[0][0].data.endsAt as Date;
    expect(updatedEndsAt.getTime() - initialEndsAt.getTime()).toBe(120_000);
  });

  it('liquida o lote vendido, debita o vencedor e credita o leiloeiro', async () => {
    const { tx, prisma, service, gateway } = makeHarness();
    const winnerAmount = new Prisma.Decimal('150.00');
    prisma.lot.findMany.mockResolvedValue([{ id: 'lot-1' }]);
    tx.lot.findUnique.mockResolvedValue({
      ...createActiveLot({
        status: LotStatus.IN_AUCTION,
        endsAt: new Date(Date.now() - 1000),
      }),
      auction: {
        id: 'auction-1',
        title: 'Leilão de teste',
        status: AuctionStatus.ACTIVE,
        auctioneerId: 'auctioneer-1',
      },
    });
    tx.bid.findFirst.mockResolvedValue({
      bidderId: 'bidder-1',
      amount: winnerAmount,
    });
    tx.bid.count.mockResolvedValue(2);
    tx.auctionReceipt.create.mockResolvedValue({ id: 'receipt-1' });
    tx.wallet.findUnique.mockResolvedValue({ id: 'wallet-winner' });
    tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    tx.wallet.upsert.mockResolvedValue({ id: 'wallet-auctioneer' });
    tx.lot.count.mockResolvedValue(0);
    tx.lot.update.mockResolvedValue({});

    const closed = await service.closeExpiredLots();

    expect(closed).toBe(1);
    expect(tx.auctionReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          winnerId: 'bidder-1',
          finalAmount: winnerAmount,
          result: LotStatus.SOLD,
          bidCount: 2,
        }),
      }),
    );
    expect(tx.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'wallet-winner' }),
        data: { committedBalance: { decrement: winnerAmount } },
      }),
    );
    expect(tx.walletTransaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            type: WalletTransactionType.AUCTION_PAYMENT,
          }),
          expect.objectContaining({
            type: WalletTransactionType.AUCTION_EARNING,
          }),
        ]),
      }),
    );
    expect(gateway.publishLotClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        status: LotStatus.SOLD,
        finalAmount: '150.00',
      }),
    );
  });

  it('fecha sem lances como UNSOLD sem movimentar carteiras', async () => {
    const { tx, prisma, service } = makeHarness();
    prisma.lot.findMany.mockResolvedValue([{ id: 'lot-1' }]);
    tx.lot.findUnique.mockResolvedValue({
      ...createActiveLot({
        status: LotStatus.AVAILABLE,
        endsAt: new Date(Date.now() - 1000),
      }),
      auction: {
        id: 'auction-1',
        title: 'Leilão de teste',
        status: AuctionStatus.ACTIVE,
        auctioneerId: 'auctioneer-1',
      },
    });
    tx.bid.findFirst.mockResolvedValue(null);
    tx.bid.count.mockResolvedValue(0);
    tx.auctionReceipt.create.mockResolvedValue({ id: 'receipt-2' });
    tx.lot.count.mockResolvedValue(0);
    tx.lot.update.mockResolvedValue({});

    const closed = await service.closeExpiredLots();

    expect(closed).toBe(1);
    expect(tx.auctionReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          winnerId: null,
          finalAmount: new Prisma.Decimal(0),
          result: LotStatus.UNSOLD,
        }),
      }),
    );
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.wallet.upsert).not.toHaveBeenCalled();
  });
});
