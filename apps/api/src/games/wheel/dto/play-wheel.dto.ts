import { IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlayWheelDto {
  @ApiProperty({ description: 'Bet amount in lamports as a decimal integer string', example: '100000000' })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;
}
