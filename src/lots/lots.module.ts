import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LotsService } from './lots.service';
import { LotsController } from './lots.controller';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [LotsController],
  providers: [LotsService],
})
export class LotsModule {}
