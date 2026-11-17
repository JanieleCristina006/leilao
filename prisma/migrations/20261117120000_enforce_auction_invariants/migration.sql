-- Existing invalid financial data must be reconciled before this migration.
-- Do not silently rewrite balances or invent signatures for legacy bids.
BEGIN;
ALTER TABLE "Lot" ADD COLUMN "bidAuditSignature" VARCHAR(64);
ALTER TABLE "Bid" ADD COLUMN "auditVersion" INTEGER;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_nonnegative_balances"
  CHECK ("availableBalance" >= 0 AND "committedBalance" >= 0);
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_positive_prices"
  CHECK ("startingBid" > 0 AND "minimumIncrement" > 0 AND ("currentBid" IS NULL OR "currentBid" > 0));
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_nonnegative_audit_count" CHECK ("bidAuditCount" >= 0);
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_positive_amount" CHECK ("amount" > 0);
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_positive_amount" CHECK ("amount" > 0);
ALTER TABLE "AuctionReceipt" ADD CONSTRAINT "AuctionReceipt_nonnegative_amount" CHECK ("finalAmount" >= 0);
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_valid_period" CHECK ("endsAt" > "startsAt");
COMMIT;
