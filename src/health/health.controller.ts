import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection, ConnectionStates } from 'mongoose';

import { Public } from '../common/decorators/public.decorator';

/** Mongoose exposes readyState as a number; the health payload reads better as a word. */
const READY_STATE_LABELS: Record<number, string> = {
  [ConnectionStates.disconnected]: 'disconnected',
  [ConnectionStates.connected]: 'connected',
  [ConnectionStates.connecting]: 'connecting',
  [ConnectionStates.disconnecting]: 'disconnecting',
  [ConnectionStates.uninitialized]: 'uninitialized',
};

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  // Must stay public: the platform health check has no credentials.
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe and database connection state' })
  check() {
    return {
      status: 'ok',
      db: READY_STATE_LABELS[this.connection.readyState] ?? 'unknown',
      timestamp: new Date().toISOString(),
    };
  }
}
