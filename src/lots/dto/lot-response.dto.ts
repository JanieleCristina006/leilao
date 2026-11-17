import { ApiProperty } from '@nestjs/swagger';
import { LotStatus } from '../../../generated/prisma/enums.js';

export class LotResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ format: 'uuid' })
  auctionId: string;
  @ApiProperty()
  title: string;
  @ApiProperty({ type: String, nullable: true })
  description: string | null;
  @ApiProperty({ type: String, nullable: true })
  imageUrl: string | null;
  @ApiProperty({ type: String, nullable: true })
  externalId: string | null;
  @ApiProperty({ enum: LotStatus })
  status: LotStatus;
  @ApiProperty({ example: '100.00' })
  startingBid: string;
  @ApiProperty({ example: '1.00' })
  minimumIncrement: string;
  @ApiProperty({ type: String, nullable: true, example: '110.00' })
  currentBid: string | null;
  @ApiProperty({ minimum: 0, example: 4 })
  bidCount: number;
  @ApiProperty({ format: 'date-time' })
  endsAt: string;
  @ApiProperty({ format: 'date-time' })
  createdAt: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}
