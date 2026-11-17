import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuctionStatus, LotStatus } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuctionsService } from './auctions.service.js';

describe('Auction state and time invariants', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const active = {
    id: 'auction',
    auctioneerId: 'owner',
    status: AuctionStatus.ACTIVE,
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 60_000),
  };
  let tx: any;
  let prisma: any;
  let service: AuctionsService;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    tx = {
      auction: {
        findFirst: jest.fn().mockResolvedValue(active),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      lot: { updateMany: jest.fn() },
      bid: { count: jest.fn().mockResolvedValue(1) },
    };
    prisma = {
      auction: {
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    service = new AuctionsService(prisma as PrismaService);
  });
  afterEach(() => jest.useRealTimers());

  it('rejects auctions entirely in the past', async () => {
    await expect(
      service.create('owner', {
        title: 'Test',
        startsAt: '2026-11-16T10:00:00Z',
        endsAt: '2026-11-16T11:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auction.create).not.toHaveBeenCalled();
  });
  it('rejects cancelling an auction with bids without changing lots', async () => {
    await expect(
      service.update('auction', 'owner', { status: AuctionStatus.CANCELLED }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.lot.updateMany).not.toHaveBeenCalled();
    expect(tx.auction.update).not.toHaveBeenCalled();
  });
  it('cancels open lots together with an auction without bids', async () => {
    tx.bid.count.mockResolvedValue(0);
    await service.update('auction', 'owner', {
      status: AuctionStatus.CANCELLED,
    });
    expect(tx.lot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: LotStatus.CANCELLED } }),
    );
    expect(tx.auction.update).toHaveBeenCalled();
  });
  it('rejects changing the deadline of an ongoing auction', async () => {
    await expect(
      service.update('auction', 'owner', { endsAt: '2026-11-17T12:00:20Z' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([AuctionStatus.FINISHED, AuctionStatus.CANCELLED])(
    'does not reopen %s auctions',
    async (status) => {
      tx.auction.findFirst.mockResolvedValue({ ...active, status });
      await expect(
        service.update('auction', 'owner', { status: AuctionStatus.SCHEDULED }),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it('leaves auctions with open lots for settlement instead of finishing at the original deadline', async () => {
    await service.updateScheduledStatuses();
    expect(tx.auction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lots: {
            none: {
              status: { in: [LotStatus.AVAILABLE, LotStatus.IN_AUCTION] },
            },
          },
        }),
      }),
    );
  });
  it('rechecks cancellation after a concurrent bid commits', async () => {
    tx.bid.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    tx.auction.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '7.10.1',
      }),
    );
    await expect(
      service.update('auction', 'owner', { status: AuctionStatus.CANCELLED }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.bid.count).toHaveBeenCalledTimes(2);
  });
});
