// Run only against a disposable database whose name ends in _test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client.js');
const { BidsService } = require('../dist/src/bids/bids.service.js');
const { AuctionsService } = require('../dist/src/auctions/auctions.service.js');
const { LotsService } = require('../dist/src/lots/lots.service.js');
const { randomUUID } = require('node:crypto');
const {
  createBidAuditSignature,
} = require('../dist/src/bids/bid-audit.utils.js');

test('PostgreSQL: concurrent bids, extended time, cancellation, HMAC and settlement', async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(
    connectionString && new URL(connectionString).pathname.endsWith('_test'),
    'Use a disposable DATABASE_URL ending in _test.',
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const profileIds = [randomUUID(), randomUUID(), randomUUID()];
  const auctionId = randomUUID();
  const lotId = randomUUID();
  const bids = new BidsService(prisma, {
    publishBidAccepted() {},
    publishLotClosed() {},
  });
  const auctions = new AuctionsService(prisma);
  const lots = new LotsService(prisma);
  try {
    for (let i = 0; i < profileIds.length; i++) {
      await prisma.profile.create({
        data: {
          id: profileIds[i],
          email: `${profileIds[i]}@example.test`,
          name: `Test ${i}`,
          passwordHash: 'unused',
          role: i === 0 ? 'AUCTIONEER' : 'BIDDER',
          wallet: { create: { availableBalance: i === 0 ? '0' : '1000' } },
        },
      });
    }
    await prisma.auction.create({
      data: {
        id: auctionId,
        title: 'Integration test',
        auctioneerId: profileIds[0],
        status: 'ACTIVE',
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 25_000),
      },
    });
    await prisma.lot.create({
      data: {
        id: lotId,
        title: 'Test artwork',
        auctionId,
        startingBid: '100',
        endsAt: new Date(Date.now() + 25_000),
        bidAuditSignature: createBidAuditSignature(lotId, 0, null),
      },
    });
    const before = Date.now();
    const results = await Promise.allSettled(
      profileIds
        .slice(1)
        .map((bidderId) => bids.create(bidderId, { lotId, amount: '100.00' })),
    );
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(await prisma.bid.count({ where: { lotId } }), 1);
    let lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    assert.ok(lot.endsAt.getTime() >= before + 120_000);
    assert.ok(lot.endsAt.getTime() <= Date.now() + 120_000);
    const first = await prisma.bid.findFirstOrThrow({ where: { lotId } });
    const nextBidder = profileIds.slice(1).find((id) => id !== first.bidderId);
    // Original auction deadline passes; the lot's extension remains authoritative.
    await prisma.auction.update({
      where: { id: auctionId },
      data: { endsAt: new Date(Date.now() - 1) },
    });
    await auctions.updateScheduledStatuses();
    assert.equal(
      (await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } }))
        .status,
      'ACTIVE',
    );
    assert.equal(await bids.closeExpiredLots(), 0);
    await bids.create(nextBidder, { lotId, amount: '110.00' });
    assert.equal(
      (
        await prisma.wallet.findUniqueOrThrow({
          where: { profileId: first.bidderId },
        })
      ).availableBalance.toFixed(2),
      '1000.00',
    );
    await assert.rejects(
      auctions.update(auctionId, profileIds[0], { status: 'CANCELLED' }),
      (error) => error.getStatus() === 409,
    );
    await assert.rejects(
      lots.update(lotId, profileIds[0], { startingBid: 5000 }),
      (error) => error.getStatus() === 409,
    );
    await assert.rejects(
      lots.remove(lotId, profileIds[0]),
      (error) => error.getStatus() === 409,
    );
    assert.equal((await lots.getPublicAudit(lotId)).integrity, 'INTACT');
    await prisma.bid.update({ where: { id: first.id }, data: { amount: '1' } });
    assert.equal((await lots.getPublicAudit(lotId)).integrity, 'TAMPERED');
    await prisma.bid.update({
      where: { id: first.id },
      data: { amount: first.amount },
    });
    await assert.rejects(
      prisma.wallet.update({
        where: { profileId: nextBidder },
        data: { availableBalance: '-1' },
      }),
    );
    await assert.rejects(
      prisma.lot.update({ where: { id: lotId }, data: { startingBid: '0' } }),
    );
    await prisma.lot.update({
      where: { id: lotId },
      data: { endsAt: new Date(Date.now() - 1) },
    });
    await bids.closeExpiredLots();
    assert.equal(
      (await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).status,
      'SOLD',
    );
    assert.equal(
      (
        await prisma.wallet.findUniqueOrThrow({
          where: { profileId: profileIds[0] },
        })
      ).availableBalance.toFixed(2),
      '110.00',
    );
    assert.equal(
      (
        await prisma.wallet.findUniqueOrThrow({
          where: { profileId: nextBidder },
        })
      ).committedBalance.toFixed(2),
      '0.00',
    );
    assert.equal(
      (
        await prisma.auctionReceipt.findUniqueOrThrow({ where: { lotId } })
      ).finalAmount.toFixed(2),
      '110.00',
    );
    assert.equal((await lots.getPublicAudit(lotId)).integrity, 'INTACT');
  } finally {
    // Delete only this test's records, including after a failed assertion.
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { profileId: { in: profileIds } } },
    });
    await prisma.auctionReceipt.deleteMany({ where: { lotId } });
    const testBids = await prisma.bid.findMany({
      where: { lotId },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        entityType: 'Bid',
        entityId: { in: testBids.map((bid) => bid.id) },
      },
    });
    await prisma.bid.deleteMany({ where: { lotId } });
    await prisma.lot.deleteMany({ where: { id: lotId } });
    await prisma.auction.deleteMany({ where: { id: auctionId } });
    await prisma.wallet.deleteMany({
      where: { profileId: { in: profileIds } },
    });
    await prisma.profile.deleteMany({ where: { id: { in: profileIds } } });
    await prisma.$disconnect();
  }
});
