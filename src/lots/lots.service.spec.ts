import { ConflictException } from '@nestjs/common';
import {
  AuctionStatus,
  BidStatus,
  LotStatus,
} from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createBidAuditHash } from '../bids/bid-audit.utils.js';
import { LotsService } from './lots.service.js';

const makeHarness = () => {
  const tx = {
    lot: {
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    bid: { count: jest.fn() },
    auction: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    lot: { findUnique: jest.fn() },
  };
  return {
    tx,
    prisma,
    service: new LotsService(prisma as unknown as PrismaService),
  };
};

const makeAuditedBid = (amount = '100.00') => {
  const bid = {
    id: 'bid-1',
    lotId: 'lot-1',
    bidderId: 'private-bidder-id',
    amount: new Prisma.Decimal(amount),
    status: BidStatus.ACCEPTED,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    auditSequence: 1,
    auditPreviousHash: null,
    auditHash: '',
  };
  bid.auditHash = createBidAuditHash({
    id: bid.id,
    lotId: bid.lotId,
    bidderId: bid.bidderId,
    amount: bid.amount.toFixed(2),
    status: bid.status,
    createdAt: bid.createdAt,
    sequence: bid.auditSequence,
    previousHash: bid.auditPreviousHash,
  });
  return bid;
};

describe('LotsService comprovante, auditoria e cancelamento', () => {
  it('informa que uma cadeia de hashes válida está íntegra', async () => {
    const { prisma, service } = makeHarness();
    const bid = makeAuditedBid();
    prisma.lot.findUnique.mockResolvedValue({
      id: 'lot-1',
      bidAuditHead: bid.auditHash,
      bidAuditCount: 1,
      receipt: null,
      bids: [bid],
    });

    const result = await service.getPublicAudit('lot-1');

    expect(result.integrity).toBe('INTACT');
    expect(result.isIntact).toBe(true);
    expect(result.verifiedBidCount).toBe(1);
    expect(result.events[0]).not.toHaveProperty('bidderId');
  });

  it('detecta alteração no valor de um lance depois que o hash foi gravado', async () => {
    const { prisma, service } = makeHarness();
    const bid = makeAuditedBid('101.00');
    // O hash conserva o valor original, simulando edição direta do lance.
    bid.auditHash = createBidAuditHash({
      ...bid,
      amount: '100.00',
      sequence: 1,
      previousHash: null,
    });
    prisma.lot.findUnique.mockResolvedValue({
      id: 'lot-1',
      bidAuditHead: bid.auditHash,
      bidAuditCount: 1,
      receipt: null,
      bids: [bid],
    });

    const result = await service.getPublicAudit('lot-1');

    expect(result.integrity).toBe('TAMPERED');
    expect(result.isIntact).toBe(false);
  });

  it('marca como INCOMPLETE o histórico antigo sem hashes', async () => {
    const { prisma, service } = makeHarness();
    prisma.lot.findUnique.mockResolvedValue({
      id: 'lot-1',
      bidAuditHead: null,
      bidAuditCount: 0,
      receipt: null,
      bids: [
        {
          ...makeAuditedBid(),
          auditSequence: null,
          auditPreviousHash: null,
          auditHash: null,
        },
      ],
    });

    const result = await service.getPublicAudit('lot-1');

    expect(result.integrity).toBe('INCOMPLETE');
    expect(result.isIntact).toBeNull();
    expect(result.unauditedBidCount).toBe(1);
  });

  it('retorna comprovante público sem IDs ou dados pessoais do licitante', async () => {
    const { prisma, service } = makeHarness();
    const bid = makeAuditedBid();
    const auditSnapshot = {
      bidHistoryHash: bid.auditHash,
      bidCount: 1,
      bidAuditCount: 1,
    };
    prisma.lot.findUnique
      .mockResolvedValueOnce({
        id: 'lot-1',
        title: 'Obra de teste',
        description: null,
        imageUrl: null,
        startingBid: new Prisma.Decimal('80.00'),
        status: LotStatus.SOLD,
        auction: { id: 'auction-1', title: 'Leilão de teste' },
        receipt: {
          id: 'receipt-1',
          finalAmount: new Prisma.Decimal('100.00'),
          issuedAt: new Date('2026-01-01T13:00:00.000Z'),
          result: LotStatus.SOLD,
          lotTitle: 'Obra de teste',
          lotDescription: null,
          lotImageUrl: null,
          startingBid: new Prisma.Decimal('80.00'),
          auctionTitle: 'Leilão de teste',
          ...auditSnapshot,
          winnerId: 'private-winner-id',
        },
      })
      .mockResolvedValueOnce({
        id: 'lot-1',
        bidAuditHead: bid.auditHash,
        bidAuditCount: 1,
        receipt: auditSnapshot,
        bids: [bid],
      });

    const receipt = await service.getPublicReceipt('lot-1');
    const serialized = JSON.stringify(receipt);

    expect(receipt.finalAmount).toBe('100.00');
    expect(serialized).not.toContain('private-winner-id');
    expect(serialized).not.toContain('private-bidder-id');
    expect(serialized).not.toContain('email');
  });

  it('recusa cancelar lote que já recebeu lance', async () => {
    const { tx, service } = makeHarness();
    tx.lot.findFirst.mockResolvedValue({
      id: 'lot-1',
      status: LotStatus.IN_AUCTION,
      endsAt: new Date(Date.now() + 60_000),
      auctionId: 'auction-1',
      auction: { status: AuctionStatus.ACTIVE },
    });
    tx.bid.count.mockResolvedValue(1);

    await expect(
      service.cancel('lot-1', 'auctioneer-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.lot.update).not.toHaveBeenCalled();
  });

  it('cancela lote sem lances e finaliza leilão sem outros lotes abertos', async () => {
    const { tx, service } = makeHarness();
    const cancelled = { id: 'lot-1', status: LotStatus.CANCELLED };
    tx.lot.findFirst.mockResolvedValue({
      id: 'lot-1',
      status: LotStatus.AVAILABLE,
      endsAt: new Date(Date.now() + 60_000),
      auctionId: 'auction-1',
      auction: { status: AuctionStatus.ACTIVE },
    });
    tx.bid.count.mockResolvedValue(0);
    tx.lot.update.mockResolvedValue(cancelled);
    tx.lot.count.mockResolvedValue(0);

    const result = await service.cancel('lot-1', 'auctioneer-1');

    expect(result).toBe(cancelled);
    expect(tx.lot.update).toHaveBeenCalledWith({
      where: { id: 'lot-1' },
      data: { status: LotStatus.CANCELLED, currentBid: null },
    });
    expect(tx.auction.updateMany).toHaveBeenCalledWith({
      where: { id: 'auction-1', status: AuctionStatus.ACTIVE },
      data: { status: AuctionStatus.FINISHED },
    });
  });
});
