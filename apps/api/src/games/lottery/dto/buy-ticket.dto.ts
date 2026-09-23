import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';
import { LOTTERY } from '@scadium/shared';

/** Exactly one ticket's picks — the free-ticket route, which spends one at a time. */
export class TicketDigitsDto {
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

/**
 * A paid purchase: one ticket (`digits`) or a batch (`tickets`, up to
 * MAX_TICKETS_PER_PURCHASE) charged ONCE at the advertised bulk price. Each
 * pick's 6 digits are validated by the service.
 */
export class BuyTicketDto {
  @ApiPropertyOptional({
    description: 'One ticket: 6 digits, each 0..9',
    example: [1, 5, 9, 0, 3, 7],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(6)
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(9, { each: true })
  digits?: number[];

  @ApiPropertyOptional({
    description: `A batch of tickets (1..${LOTTERY.MAX_TICKETS_PER_PURCHASE}), each 6 digits 0..9`,
    example: [
      [1, 5, 9, 0, 3, 7],
      [2, 2, 4, 6, 8, 0],
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LOTTERY.MAX_TICKETS_PER_PURCHASE)
  tickets?: number[][];
}
