import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateLotDto } from './create-lot.dto';

export class UpdateLotDto extends PartialType(
  OmitType(CreateLotDto, ['auctionId', 'minimumIncrement'] as const),
) {}
