import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { BidsService } from './bids.service.js';
import { CreateBidDto } from './dto/create-bid.dto.js';

type AuthenticatedRequest = {
  user: { userId: string };
};

@Controller('bids')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Get('me/wins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.BIDDER)
  findMyWins(@Req() request: AuthenticatedRequest) {
    return this.bidsService.findMyWins(request.user.userId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.BIDDER)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() createBidDto: CreateBidDto,
  ) {
    return this.bidsService.create(request.user.userId, createBidDto);
  }
}
