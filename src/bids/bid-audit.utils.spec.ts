import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LotsService } from '../lots/lots.service.js';
import {
  createBidAuditHash,
  createBidAuditSignature,
  validateAuditSecret,
} from './bid-audit.utils.js';

describe('Keyed bid audit', () => {
  const makeLot = () => {
    const record = {
      id: 'bid',
      lotId: 'lot',
      bidderId: 'private',
      amount: '100.00',
      status: 'ACCEPTED',
      createdAt: new Date('2026-11-17T12:00:00Z'),
      sequence: 1,
      previousHash: null,
    };
    const hash = createBidAuditHash(record);
    return {
      id: 'lot',
      bidAuditCount: 1,
      bidAuditHead: hash,
      bidAuditSignature: createBidAuditSignature('lot', 1, hash),
      receipt: null,
      bids: [
        {
          ...record,
          amount: new Prisma.Decimal(record.amount),
          auditSequence: 1,
          auditVersion: 2,
          auditPreviousHash: null,
          auditHash: hash,
        },
      ],
    };
  };
  const verify = (lot: any) =>
    new LotsService({
      lot: { findUnique: async () => lot },
    } as unknown as PrismaService).getPublicAudit('lot');
  it('verifies a signed history', async () => {
    expect((await verify(makeLot())).integrity).toBe('INTACT');
  });
  it('detects an attacker rewriting the bid, hashes and anchor using SHA-256', async () => {
    const lot = makeLot();
    lot.bids[0].amount = new Prisma.Decimal('1.00');
    lot.bids[0].auditHash = createHash('sha256')
      .update(JSON.stringify(lot.bids[0]))
      .digest('hex');
    lot.bidAuditHead = lot.bids[0].auditHash;
    expect((await verify(lot)).integrity).toBe('TAMPERED');
  });
  it('detects truncation even if the count and head are rewritten', async () => {
    const lot = makeLot();
    lot.bids = [];
    lot.bidAuditCount = 0;
    lot.bidAuditHead = null as any;
    expect((await verify(lot)).integrity).toBe('TAMPERED');
  });
  it('never claims integrity when the signature and entire history have been removed', async () => {
    expect(
      (
        await verify({
          id: 'lot',
          bids: [],
          bidAuditCount: 0,
          bidAuditHead: null,
          bidAuditSignature: null,
          receipt: null,
        })
      ).integrity,
    ).toBe('INCOMPLETE');
  });
  it('marks unsigned legacy histories as incomplete', async () => {
    const lot = makeLot();
    lot.bidAuditSignature = null as any;
    expect((await verify(lot)).integrity).toBe('INCOMPLETE');
  });
  it('requires an independent secret outside the database', () => {
    const original = process.env.BID_AUDIT_SECRET;
    try {
      delete process.env.BID_AUDIT_SECRET;
      expect(validateAuditSecret).toThrow();
      process.env.BID_AUDIT_SECRET = 'short';
      expect(validateAuditSecret).toThrow();
    } finally {
      process.env.BID_AUDIT_SECRET = original;
    }
  });
});
