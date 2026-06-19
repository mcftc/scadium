import { IsInt, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PLINKO } from '@scadium/shared';

export class PlayPlinkoDto {
  @ApiProperty({ description: 'Bet amount in lamports as a decimal integer string', example: '100000000' })
  @IsString()
  @Matches(/^\d+$/, { message: 'amountLamports must be a positive integer string' })
  amountLamports!: string;

  @ApiProperty({ description: 'Number of peg rows', enum: PLINKO.ROWS })
  @IsInt()
  rows!: number;
}
