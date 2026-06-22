import { IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MINES } from '@scadium/shared';

export class PickMinesDto {
  @ApiProperty({ description: 'Cell index to reveal', minimum: 0, maximum: MINES.CELLS - 1 })
  @IsInt()
  @Min(0)
  @Max(MINES.CELLS - 1)
  cell!: number;
}
