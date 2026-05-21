import { IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlaceCrashBetDto {
  @ApiProperty({ description: 'Bet amount as lamports (integer string)' })
  @IsString()
  @Matches(/^\d+$/)
  amountLamports!: string;

  @ApiPropertyOptional({ description: 'Auto cash-out multiplier (e.g. 2.0 for 2x)' })
  @IsOptional()
  @IsNumber()
  @Min(1.01)
  @Max(1_000_000)
  autoCashout?: number;
}
