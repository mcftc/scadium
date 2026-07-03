import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DICE, type DiceMode } from '@scadium/shared';

export class PlayDiceDto {
  @ApiProperty({ description: 'Bet amount in lamports as a decimal integer string', example: '100000000' })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;

  @ApiProperty({ description: 'Roll-under / roll-over target', minimum: DICE.MIN_TARGET, maximum: DICE.MAX_TARGET })
  @IsNumber()
  @Min(DICE.MIN_TARGET)
  @Max(DICE.MAX_TARGET)
  target!: number;

  @ApiPropertyOptional({ enum: DICE.MODES, default: 'under', description: 'Win rule: under = roll < target, over = roll >= target' })
  @IsOptional()
  @IsIn(DICE.MODES)
  mode?: DiceMode;
}
