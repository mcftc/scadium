import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { HiloDirection } from '@scadium/shared';

export class GuessHiloDto {
  @ApiProperty({
    description: 'Guess whether the next card is higher-or-same or lower-or-same',
    enum: ['higher', 'lower'],
  })
  @IsIn(['higher', 'lower'])
  direction!: HiloDirection;
}
