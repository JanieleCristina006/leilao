import { IsString, Matches } from 'class-validator';

export class CreateDepositDto {
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/)
  amount: string;
}
