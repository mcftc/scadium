import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCoinflipDto {
  @ApiProperty({ enum: ['heads', 'tails'] })
  @IsEnum(['heads', 'tails'])
  side!: 'heads' | 'tails';

  @ApiProperty({
    description: 'Bet amount in lamports as a decimal integer string',
    example: '100000000',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;

  @ApiPropertyOptional({
    description: 'Resolve immediately against the house instead of waiting for a player',
  })
  @IsOptional()
  @IsBoolean()
  vsHouse?: boolean;
}
