import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MINES } from '@scadium/shared';

export class StartMinesDto {
  @ApiProperty({
    description: 'Bet amount in lamports as a decimal integer string',
    example: '100000000',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;

  @ApiProperty({ description: 'Number of mines on the field', minimum: MINES.MIN_MINES, maximum: MINES.MAX_MINES })
  @IsInt()
  @Min(MINES.MIN_MINES)
  @Max(MINES.MAX_MINES)
  mines!: number;
}
