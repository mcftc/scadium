import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class EnterJackpotDto {
  @ApiProperty({
    description: 'Entry amount in lamports as a decimal integer string',
    example: '100000000',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountLamports must be a positive integer string' })
  @MaxLength(20)
  amountLamports!: string;
}
