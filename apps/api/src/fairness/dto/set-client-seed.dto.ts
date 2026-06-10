import { IsString, Length } from 'class-validator';

export class SetClientSeedDto {
  @IsString()
  @Length(1, 64)
  clientSeed!: string;
}
