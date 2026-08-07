import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';

/** Mongoose exposes readyState as a number; the health payload reads better as a word. */
const READY_STATE_LABELS: Record<number, string> = {
  [ConnectionStates.disconnected]: 'disconnected',
  [ConnectionStates.connected]: 'connected',
  [ConnectionStates.connecting]: 'connecting',
  [ConnectionStates.disconnecting]: 'disconnecting',
  [ConnectionStates.uninitialized]: 'uninitialized',
};

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check() {
    return {
      status: 'ok',
      db: READY_STATE_LABELS[this.connection.readyState] ?? 'unknown',
      timestamp: new Date().toISOString(),
    };
  }
}
