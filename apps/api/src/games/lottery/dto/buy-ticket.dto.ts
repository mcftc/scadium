import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

export class BuyTicketDto {
  @ApiProperty({
    description: '5 distinct main numbers, each 1..36',
    example: [3, 11, 19, 24, 36],
  })
  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(36, { each: true })
  mainNumbers!: number[];

  @ApiProperty({ description: 'Bonus number, 1..10', example: 7 })
  @IsInt()
  @Min(1)
  @Max(10)
  bonusNumber!: number;
}
