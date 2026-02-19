import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { RedisOptions } from 'ioredis';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { RedisConfig, createRetryStrategy } from '../../common/helpers';

export class WsRedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(WsRedisIoAdapter.name);
  private readonly debug: boolean;
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private redisConfig: RedisConfig;

  constructor(
    private readonly app: any,
    private readonly environmentService: EnvironmentService,
  ) {
    super(app);
    this.redisConfig = this.environmentService.getRedisConfig();
    this.debug = this.environmentService.isDebugWs();
  }

  async connectToRedis(): Promise<void> {
    let pubClient: Redis;
    let subClient: Redis;

    if (this.redisConfig.mode === 'sentinel') {
      // Sentinel 방식
      const options: RedisOptions = {
        sentinels: this.redisConfig.sentinels,
        name: this.redisConfig.masterName,
        role: 'master',
        password: this.redisConfig.password || undefined,
        db: this.redisConfig.db,
        retryStrategy: createRetryStrategy(),
        sentinelRetryStrategy: (times) => Math.min(times * 1000, 10000),
      };

      pubClient = new Redis(options);
      subClient = new Redis(options);

      this.logger.log(`WebSocket Redis adapter initialized (mode: sentinel, master: ${this.redisConfig.masterName})`);
    } else {
      // Single Redis 방식
      pubClient = new Redis({
        host: this.redisConfig.host,
        port: this.redisConfig.port,
        password: this.redisConfig.password || undefined,
        db: this.redisConfig.db,
        retryStrategy: createRetryStrategy(),
      });

      subClient = new Redis({
        host: this.redisConfig.host,
        port: this.redisConfig.port,
        password: this.redisConfig.password || undefined,
        db: this.redisConfig.db,
        retryStrategy: createRetryStrategy(),
      });

      this.logger.log(`WebSocket Redis adapter initialized (mode: single, host: ${this.redisConfig.host}:${this.redisConfig.port})`);
    }

    // Redis 연결 상태 모니터링
    pubClient.on('connect', () => {
      if (this.debug) this.logger.log('[DEBUG] [WS:pub] Connected');
    });
    pubClient.on('ready', () => {
      if (this.debug) this.logger.log('[DEBUG] [WS:pub] Ready');
    });
    pubClient.on('error', (err) => {
      this.logger.error('[WS:pub] Error', err.message);
    });
    pubClient.on('close', () => {
      this.logger.warn('[WS:pub] Connection closed');
    });
    pubClient.on('reconnecting', (delay: number) => {
      this.logger.warn(`[WS:pub] Reconnecting in ${delay}ms`);
    });

    subClient.on('connect', () => {
      if (this.debug) this.logger.log('[DEBUG] [WS:sub] Connected');
    });
    subClient.on('ready', () => {
      if (this.debug) this.logger.log('[DEBUG] [WS:sub] Ready');
    });
    subClient.on('error', (err) => {
      this.logger.error('[WS:sub] Error', err.message);
    });
    subClient.on('close', () => {
      this.logger.warn('[WS:sub] Connection closed');
    });
    subClient.on('reconnecting', (delay: number) => {
      this.logger.warn(`[WS:sub] Reconnecting in ${delay}ms`);
    });

    // Redis 준비 완료될 때까지 대기
    await Promise.all([
      new Promise((res) => pubClient.once("ready", res)),
      new Promise((res) => subClient.once("ready", res)),
    ]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
