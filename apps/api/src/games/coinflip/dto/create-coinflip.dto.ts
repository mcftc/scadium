import { IsEnum, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCoinflipDto {
  @ApiProperty({ enum: ['heads', 'tails'] })
  @IsEnum(['heads', 'tails'])
  side!: 'heads' | 'tails';

  @ApiProperty({
    description: 'Bet amount in lamports as a decimal integer string',
    example: '100000000',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'amountLamports must be a positive integer string' })
  amountLamports!: string;
}
