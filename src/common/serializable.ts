import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Re-read every invariant after a conflicting concurrent write. */
export async function serializable<T>(
  prisma: PrismaService,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2034'
      )
        throw error;
      if (attempt === 4)
        throw new ConflictException(
          'Alteração simultânea. Atualize os dados e tente novamente.',
        );
    }
  }
  throw new ConflictException('Não foi possível concluir a operação.');
}
