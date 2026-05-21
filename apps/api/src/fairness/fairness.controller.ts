import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FairnessService } from './fairness.service';
import { VerifyFairnessDto } from './dto/verify-fairness.dto';

@ApiTags('fairness')
@Controller('fairness')
export class FairnessController {
  constructor(private readonly fairness: FairnessService) {}

  @Post('verify')
  @ApiOperation({ summary: 'Reproduce a game result from seeds (provably fair)' })
  verify(@Body() dto: VerifyFairnessDto) {
    return this.fairness.verify(dto);
  }
}
