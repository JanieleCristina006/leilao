import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateLotDto } from './create-lot.dto';

export class UpdateLotDto extends PartialType(
  OmitType(CreateLotDto, ['auctionId', 'minimumIncrement'] as const),
) {}
