import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class EnterJackpotDto {
  @ApiProperty({
    description: 'Entry amount in lamports as a decimal integer string',
    example: '100000000',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'amountLamports must be a positive integer string' })
  amountLamports!: string;
}
