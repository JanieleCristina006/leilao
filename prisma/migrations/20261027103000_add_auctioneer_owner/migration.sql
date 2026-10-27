-- Add optional ownership so existing auctions keep working until assigned.
ALTER TABLE "Auction" ADD COLUMN "auctioneerId" UUID;

CREATE INDEX "Auction_auctioneerId_idx" ON "Auction"("auctioneerId");

ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_auctioneerId_fkey"
FOREIGN KEY ("auctioneerId") REFERENCES "Profile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
