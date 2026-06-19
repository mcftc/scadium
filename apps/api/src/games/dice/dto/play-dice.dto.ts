import { IsNumber, IsString, Matches, MaxLength, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DICE } from '@scadium/shared';

export class PlayDiceDto {
  @ApiProperty({ description: 'Bet amount in lamports as a decimal integer string', example: '100000000' })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;

  @ApiProperty({ description: 'Roll-under target', minimum: DICE.MIN_TARGET, maximum: DICE.MAX_TARGET })
  @IsNumber()
  @Min(DICE.MIN_TARGET)
  @Max(DICE.MAX_TARGET)
  target!: number;
}
