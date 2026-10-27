import { IsString, IsUUID, Matches } from 'class-validator';

export class CreateBidDto {
  @IsUUID()
  lotId: string;

  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/)
  amount: string;
}
