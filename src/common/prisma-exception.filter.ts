import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const errors: Record<string, [number, string]> = {
      P2025: [404, 'Recurso não encontrado.'],
      P2002: [409, 'Já existe um registro com estes dados.'],
      P2003: [409, 'A operação conflita com registros vinculados.'],
      P2014: [409, 'A operação conflita com registros vinculados.'],
      P2004: [400, 'Os dados violam uma regra do banco.'],
      P2011: [400, 'Um campo obrigatório não pode ser nulo.'],
      P2034: [409, 'Alteração simultânea. Tente novamente.'],
    };
    const [statusCode, message] = errors[error.code] ?? [
      500,
      'Erro interno do servidor.',
    ];
    if (statusCode === 500) {
      this.logger.error(`Erro inesperado do Prisma: ${error.code}`);
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(statusCode)
      .json({ statusCode, message });
  }
}
