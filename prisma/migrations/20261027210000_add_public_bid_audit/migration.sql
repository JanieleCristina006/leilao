ALTER TABLE "Lot"
ADD COLUMN "bidAuditHead" VARCHAR(64),
ADD COLUMN "bidAuditCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Bid"
ADD COLUMN "auditSequence" INTEGER,
ADD COLUMN "auditPreviousHash" VARCHAR(64),
ADD COLUMN "auditHash" VARCHAR(64);

CREATE UNIQUE INDEX "Bid_lotId_auditSequence_key"
ON "Bid"("lotId", "auditSequence");

ALTER TABLE "AuctionReceipt"
ADD COLUMN "bidHistoryHash" VARCHAR(64),
ADD COLUMN "bidCount" INTEGER,
ADD COLUMN "bidAuditCount" INTEGER,
ADD COLUMN "result" "LotStatus",
ADD COLUMN "lotTitle" TEXT,
ADD COLUMN "lotDescription" TEXT,
ADD COLUMN "lotImageUrl" TEXT,
ADD COLUMN "startingBid" DECIMAL(12,2),
ADD COLUMN "auctionTitle" TEXT;
