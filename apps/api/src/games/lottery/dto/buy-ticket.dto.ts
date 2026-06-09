import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

export class BuyTicketDto {
  @ApiProperty({
    description: '6 digits, each 0..9, matched left-to-right (PancakeSwap style)',
    example: [1, 5, 9, 0, 3, 7],
  })
  @IsArray()
  @ArrayMinSize(6)
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(9, { each: true })
  digits!: number[];
}
