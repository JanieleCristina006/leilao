import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { LotsService } from './lots.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';

type AuthenticatedRequest = {
  user: { userId: string };
};

@Controller('lots')
export class LotsController {
  constructor(private readonly lotsService: LotsService) {}

  @Get('artworks/search')
  searchArtworks(@Query('q') query: string) {
    return this.lotsService.searchArtworks(query);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUCTIONEER)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() createLotDto: CreateLotDto,
  ) {
    return this.lotsService.create(request.user.userId, createLotDto);
  }

  @Get()
  findAll() {
    return this.lotsService.findAll();
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUCTIONEER)
  findMine(@Req() request: AuthenticatedRequest) {
    return this.lotsService.findMine(request.user.userId);
  }

  @Get(':id/audit')
  getPublicAudit(@Param('id', ParseUUIDPipe) id: string) {
    return this.lotsService.getPublicAudit(id);
  }

  @Get(':id/receipt')
  getPublicReceipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.lotsService.getPublicReceipt(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.lotsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUCTIONEER)
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateLotDto: UpdateLotDto,
  ) {
    return this.lotsService.update(id, request.user.userId, updateLotDto);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUCTIONEER)
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lotsService.cancel(id, request.user.userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUCTIONEER)
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lotsService.remove(id, request.user.userId);
  }
}
