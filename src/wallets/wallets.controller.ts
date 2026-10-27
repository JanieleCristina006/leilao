import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateDepositDto } from './dto/create-deposit.dto.js';
import { WalletsService } from './wallets.service.js';

type AuthenticatedRequest = {
  user: { userId: string };
};

@Controller('wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('me')
  @Roles(UserRole.BIDDER, UserRole.AUCTIONEER)
  findMine(@Req() request: AuthenticatedRequest) {
    return this.walletsService.findMine(request.user.userId);
  }

  @Get('me/transactions')
  @Roles(UserRole.BIDDER, UserRole.AUCTIONEER)
  findMyTransactions(@Req() request: AuthenticatedRequest) {
    return this.walletsService.findMyTransactions(request.user.userId);
  }

  @Post('deposits')
  @Roles(UserRole.BIDDER)
  createDeposit(
    @Req() request: AuthenticatedRequest,
    @Body() createDepositDto: CreateDepositDto,
  ) {
    return this.walletsService.createDeposit(
      request.user.userId,
      createDepositDto,
    );
  }
}
