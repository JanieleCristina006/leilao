import { createHmac } from 'node:crypto';

export function validateAuditSecret() {
  const secret = process.env.BID_AUDIT_SECRET;
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    secret === process.env.JWT_SECRET
  ) {
    throw new Error(
      'BID_AUDIT_SECRET deve ter pelo menos 32 bytes e ser diferente de JWT_SECRET.',
    );
  }
  return secret;
}

export function createBidAuditSignature(
  lotId: string,
  count: number,
  head: string | null,
) {
  return createHmac('sha256', validateAuditSecret())
    .update(JSON.stringify({ domain: 'lot-anchor-v2', lotId, count, head }))
    .digest('hex');
}

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
    version: 2,
    sequence: record.sequence,
    bidId: record.id,
    lotId: record.lotId,
    bidderId: record.bidderId,
    amount: record.amount,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    previousHash: record.previousHash,
  });

  return createHmac('sha256', validateAuditSecret())
    .update(canonicalRecord)
    .digest('hex');
}
