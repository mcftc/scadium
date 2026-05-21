import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BlackjackActionDto {
  @ApiProperty({ enum: ['hit', 'stand', 'double'] })
  @IsIn(['hit', 'stand', 'double'])
  action!: 'hit' | 'stand' | 'double';
}
