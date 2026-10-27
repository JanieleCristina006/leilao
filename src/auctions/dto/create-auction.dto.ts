import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AuctionStatus } from '../../../generated/prisma/enums.js';

export class CreateAuctionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(AuctionStatus)
  status?: AuctionStatus;

  @IsDateString({ strict: true })
  startsAt: string;

  @IsDateString({ strict: true })
  endsAt: string;
}
