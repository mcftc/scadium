import { IsNumber, IsString, Matches, MaxLength, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LIMBO } from '@scadium/shared';

export class PlayLimboDto {
  @ApiProperty({ description: 'Bet amount in lamports as a decimal integer string', example: '100000000' })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;

  @ApiProperty({ description: 'Target multiplier', minimum: LIMBO.MIN_TARGET, maximum: LIMBO.MAX_TARGET })
  @IsNumber()
  @Min(LIMBO.MIN_TARGET)
  @Max(LIMBO.MAX_TARGET)
  target!: number;
}
