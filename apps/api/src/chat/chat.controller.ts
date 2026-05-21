import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Recent chat history (read-only — posting goes through WebSocket)' })
  recent(@Query('limit') limit?: string) {
    return this.chat.listRecent(limit ? parseInt(limit, 10) : 50);
  }
}
