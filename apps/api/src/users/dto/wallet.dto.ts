import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Base58 Solana addresses are 32–44 chars; allow a little slack.
const ADDR_MIN = 32;
const ADDR_MAX = 64;

export class WalletAddressDto {
  @ApiProperty()
  @IsString()
  @Length(ADDR_MIN, ADDR_MAX)
  address!: string;
}

export class WalletLinkDto {
  @ApiProperty()
  @IsString()
  @Length(ADDR_MIN, ADDR_MAX)
  address!: string;

  @ApiProperty()
  @IsString()
  message!: string;

  @ApiProperty()
  @IsString()
  signature!: string;

  @ApiProperty()
  @IsString()
  nonce!: string;
}
