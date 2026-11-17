import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuctionStatus, LotStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LotsService } from './lots.service.js';

describe('Lot mutation invariants', () => {
  let tx: any;
  let service: LotsService;
  const auction = {
    status: AuctionStatus.SCHEDULED,
    startsAt: new Date('2026-11-17T13:00:00Z'),
    endsAt: new Date('2026-11-17T14:00:00Z'),
  };
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T12:00:00Z'));
    tx = {
      lot: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'lot',
            status: LotStatus.AVAILABLE,
            _count: { bids: 0 },
            auction,
          }),
        update: jest.fn().mockResolvedValue({ imageUrl: null }),
        delete: jest.fn(),
      },
      auction: { findFirst: jest.fn() },
    };
    service = new LotsService({
      $transaction: (callback) => callback(tx),
    } as unknown as PrismaService);
  });
  afterEach(() => jest.useRealTimers());
  it.each(['update', 'remove'])(
    'rejects %s for a lot with bids',
    async (operation) => {
      tx.lot.findFirst.mockResolvedValue({
        status: LotStatus.AVAILABLE,
        _count: { bids: 1 },
        auction,
      });
      await expect(
        service[operation]('lot', 'owner', { startingBid: 5000 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.lot.update).not.toHaveBeenCalled();
      expect(tx.lot.delete).not.toHaveBeenCalled();
    },
  );
  it.each([
    LotStatus.SOLD,
    LotStatus.UNSOLD,
    LotStatus.CANCELLED,
    LotStatus.IN_AUCTION,
  ])('rejects changing %s lots', async (status) => {
    tx.lot.findFirst.mockResolvedValue({
      status,
      _count: { bids: 0 },
      auction,
    });
    await expect(
      service.update('lot', 'owner', { startingBid: 100 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects changing a lot after the start even if the scheduler has not run', async () => {
    tx.lot.findFirst.mockResolvedValue({
      status: LotStatus.AVAILABLE,
      _count: { bids: 0 },
      auction: { ...auction, startsAt: new Date(Date.now() - 1) },
    });
    await expect(service.remove('lot', 'owner')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('returns 404 for an unknown lot or another owner', async () => {
    tx.lot.findFirst.mockResolvedValue(null);
    await expect(
      service.update('lot', 'other', { title: 'Changed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([0, -1, 1.001, Infinity])(
    'rejects invalid starting bid %s in the service',
    async (startingBid) => {
      await expect(
        service.create('owner', {
          auctionId: 'auction',
          title: 'Test',
          startingBid,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.auction.findFirst).not.toHaveBeenCalled();
    },
  );
  it('permits changing a scheduled lot without bids', async () => {
    await service.update('lot', 'owner', { startingBid: 200 });
    expect(tx.lot.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { startingBid: 200 } }),
    );
  });
});
