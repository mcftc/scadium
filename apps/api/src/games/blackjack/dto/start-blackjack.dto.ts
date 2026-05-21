import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartBlackjackDto {
  @ApiProperty({ description: 'Bet in lamports' })
  @IsString()
  @Matches(/^\d+$/)
  amountLamports!: string;
}
