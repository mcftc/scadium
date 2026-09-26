import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { KENO, KENO_RISKS, type KenoRisk } from '@scadium/shared';

export class PlayKenoDto {
  @ApiProperty({
    description: 'Bet amount in lamports as a decimal integer string',
    example: '100000000',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;

  @ApiProperty({
    description: `Chosen numbers (1..${KENO.CELLS}, ${KENO.MIN_PICKS}-${KENO.MAX_PICKS} distinct)`,
  })
  @IsArray()
  @ArrayMinSize(KENO.MIN_PICKS)
  @ArrayMaxSize(KENO.MAX_PICKS)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(KENO.CELLS, { each: true })
  picks!: number[];

  @ApiProperty({ enum: KENO_RISKS })
  @IsIn(KENO_RISKS)
  risk!: KenoRisk;
}
