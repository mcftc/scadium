import { IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TOWER } from '@scadium/shared';

export class PickTowerDto {
  @ApiProperty({ description: 'Column to step on in the current row', minimum: 0, maximum: TOWER.COLUMNS - 1 })
  @IsInt()
  @Min(0)
  @Max(TOWER.COLUMNS - 1)
  column!: number;
}
