import { Controller, Get, Query } from '@nestjs/common';
import { parseLimit } from '../common/parse-limit';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Recent chat history (read-only — posting goes through WebSocket)' })
  recent(@Query('limit') limit?: string) {
    return this.chat.listRecent(parseLimit(limit, 50, 200));
  }
}
