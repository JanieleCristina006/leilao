import type { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';

describe('Prisma HTTP errors', () => {
  it.each([
    ['P2025', 404],
    ['P2003', 409],
    ['P2014', 409],
    ['P2002', 409],
    ['P2004', 400],
    ['P2011', 400],
    ['P2034', 409],
    ['P9999', 500],
  ])('maps %s to %s without database details', (code, expected) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    new PrismaExceptionFilter().catch(
      new Prisma.PrismaClientKnownRequestError('private SQL details', {
        code: String(code),
        clientVersion: '7.10.1',
        meta: { sql: 'private' },
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(expected);
    expect(JSON.stringify(json.mock.calls)).not.toContain('private');
  });
});
