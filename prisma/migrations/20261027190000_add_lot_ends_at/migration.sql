ALTER TABLE "Lot"
ADD COLUMN "endsAt" TIMESTAMP(3);

UPDATE "Lot" AS lot
SET "endsAt" = auction."endsAt"
FROM "Auction" AS auction
WHERE lot."auctionId" = auction."id";

ALTER TABLE "Lot"
ALTER COLUMN "endsAt" SET NOT NULL;
