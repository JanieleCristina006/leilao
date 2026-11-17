import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { AuctionStatus, UserRole } from '../generated/prisma/enums.js';
import { createBidAuditSignature } from '../src/bids/bid-audit.utils.js';

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12)
    throw new Error(
      'Defina SEED_PASSWORD com pelo menos 12 caracteres para criar as contas de demonstração.',
    );
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL obrigatória.');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const profiles = [
      {
        email: 'admin@example.test',
        name: 'Administrador Demo',
        role: UserRole.ADMIN,
      },
      {
        email: 'leiloeiro@example.test',
        name: 'Leiloeiro Demo',
        role: UserRole.AUCTIONEER,
      },
      {
        email: 'licitante1@example.test',
        name: 'Licitante Demo 1',
        role: UserRole.BIDDER,
      },
      {
        email: 'licitante2@example.test',
        name: 'Licitante Demo 2',
        role: UserRole.BIDDER,
      },
    ];
    for (const profile of profiles) {
      await prisma.profile.upsert({
        where: { email: profile.email },
        update: {},
        create: { ...profile, passwordHash, wallet: { create: {} } },
      });
    }
    const owner = await prisma.profile.findUniqueOrThrow({
      where: { email: 'leiloeiro@example.test' },
    });
    const auctionId = '00000000-0000-4000-8000-000000000001';
    const endsAt = new Date(Date.now() + 60 * 60_000);
    await prisma.auction.upsert({
      where: { id: auctionId },
      update: {},
      create: {
        id: auctionId,
        title: 'Leilão de demonstração',
        auctioneerId: owner.id,
        status: AuctionStatus.SCHEDULED,
        startsAt: new Date(Date.now() + 5 * 60_000),
        endsAt,
      },
    });
    // Preserve existing deadlines and balances when the seed is run again.
    const auction = await prisma.auction.findUniqueOrThrow({
      where: { id: auctionId },
    });
    if (auction.startsAt > new Date()) {
      for (let index = 2; index <= 3; index++) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        await prisma.lot.upsert({
          where: { id },
          update: {},
          create: {
            id,
            auctionId,
            title: `Obra de demonstração ${index - 1}`,
            startingBid: '100.00',
            endsAt: auction.endsAt,
            bidAuditSignature: createBidAuditSignature(id, 0, null),
          },
        });
      }
    }
    console.log(
      'Seed concluído. Contas @example.test criadas; faça login e deposite pela API para participar.',
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
