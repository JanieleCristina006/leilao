import { JwtService } from '@nestjs/jwt';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BidsGateway } from './bids.gateway.js';

describe('Live bid contract and privacy', () => {
  it('publishes anonymous labels, counts and sequence numbers', () => {
    const emit = jest.fn();
    const gateway = new BidsGateway({} as JwtService, {} as PrismaService);
    (gateway as any).server = { to: () => ({ emit }) };
    gateway.publishBidAccepted({
      lotId: 'lot',
      bidId: 'bid',
      bidderId: 'private-bidder',
      sequence: 4,
      bidCount: 4,
      previousLeaderId: null,
      amount: '100.00',
      createdAt: new Date(),
      endsAt: new Date(),
    });
    const event = emit.mock.calls.find(([name]) => name === 'bid.updated')[1];
    expect(event.bidCount).toBe(4);
    expect(event.bid.sequence).toBe(4);
    expect(event.bid.bidderLabel).toMatch(/^Licitante [a-f0-9]{12}$/);
    expect(JSON.stringify(event)).not.toContain('private-bidder');
  });

  it('returns the total count independently of the history page and hides names', async () => {
    const decimal = new Prisma.Decimal('100');
    const prisma = {
      lot: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 'lot',
            title: 'Test',
            status: 'IN_AUCTION',
            startingBid: decimal,
            minimumIncrement: decimal,
            currentBid: decimal,
            endsAt: new Date(),
            auction: { status: 'ACTIVE', startsAt: new Date() },
            _count: { bids: 51 },
          }),
      },
      bid: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: 'bid',
              bidderId: 'private-bidder',
              bidder: { name: 'Private name' },
              auditSequence: 51,
              amount: decimal,
              createdAt: new Date(),
            },
          ]),
        findFirst: jest.fn().mockResolvedValue({ bidderId: 'private-bidder' }),
      },
    };
    const gateway = new BidsGateway(
      {} as JwtService,
      prisma as unknown as PrismaService,
    );
    const snapshot = await (gateway as any).getLotSnapshot('lot', 'other-user');
    expect(snapshot.lot.bidCount).toBe(51);
    expect(snapshot.history[0].sequence).toBe(51);
    expect(snapshot.history[0].isMine).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('Private name');
    expect(JSON.stringify(snapshot)).not.toContain('private-bidder');
  });
});
