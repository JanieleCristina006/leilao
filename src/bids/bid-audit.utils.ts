import { createHash } from 'node:crypto';

export type BidAuditRecord = {
  id: string;
  lotId: string;
  bidderId: string;
  amount: string;
  status: string;
  createdAt: Date;
  sequence: number;
  previousHash: string | null;
};

export function createBidAuditHash(record: BidAuditRecord) {
  const canonicalRecord = JSON.stringify({
    version: 1,
    sequence: record.sequence,
    bidId: record.id,
    lotId: record.lotId,
    bidderId: record.bidderId,
    amount: record.amount,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    previousHash: record.previousHash,
  });

  return createHash('sha256').update(canonicalRecord).digest('hex');
}
