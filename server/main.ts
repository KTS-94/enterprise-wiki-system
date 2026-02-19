/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * Referer 검증, 워크스페이스 유효성 검사, Fastify 커스텀 설정
 */
// apps/server/src/main.ts
import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { HttpException, Logger, NotFoundException, ValidationPipe } from '@nestjs/common';
import { TransformHttpResponseInterceptor } from './common/interceptors/http-response.interceptor';
import { AllExceptionsFilter } from './common/filters/exception.filter';
import { WsRedisIoAdapter } from './ws/adapter/ws-redis.adapter';
import { InternalLogFilter } from './common/logger/internal-log-filter';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import { EnvironmentService } from './integrations/environment/environment.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      ignoreTrailingSlash: true,
      ignoreDuplicateSlashes: true,
      maxParamLength: 1000,
      trustProxy: true,
    }),
    {
      rawBody: true,
      logger: new InternalLogFilter(),
    },
  );
  // 로그/에러
  const logger = new Logger('NestApplication');

  // 모든 API는 /api 아래로
  app.setGlobalPrefix('api', {
    exclude: ['robots.txt', 'share/:shareId/p/:pageSlug'],
  });

  const reflector = app.get(Reflector);
  const environmentService = app.get(EnvironmentService);
  const wsAdapter = new WsRedisIoAdapter(app, environmentService);
  
  try {
    await wsAdapter.connectToRedis();
    app.useWebSocketAdapter(wsAdapter);
  } catch (err) {
    logger.error('Failed to initialize Redis WebSocket adapter', err);
    // 서버는 계속 실행되지만 실시간 기능은 비활성화됨
  }

  // 플러그인
  await app.register(fastifyMultipart);
  await app.register(fastifyCookie);

  const fastifyInstance = app.getHttpAdapter().getInstance();
  
  fastifyInstance
    .decorateReply('setHeader', function (name: string, value: unknown) {
      this.header(name, value);
    })
    .decorateReply('end', function () {
      this.send('');
    })
    .addHook('onError', function (request: any, reply: any, error: any, done: any) {
      // Fastify 훅에서 발생한 예외를 로깅
      if (error instanceof HttpException) {
        const status = error.getStatus();
        const message = error.getResponse();
        const errorMessage = typeof message === 'string' ? message : (message as any)?.message || 'Unknown error';
        
        if (status >= 500) {
          logger.error(
            `${request.method} ${request.url} - ${status} - ${errorMessage}`,
            error.stack,
          );
        } else {
          logger.warn(
            `${request.method} ${request.url} - ${status} - ${errorMessage}`,
          );
        }
      } else {
        logger.error(
          `${request.method} ${request.url} - Unhandled error`,
          error.stack || error,
        );
      }
      done();
    })
    .addHook('preHandler', function (req: any, _reply: any, done: any) {
      // API 요청이 아닌 경우에만 referer 체크 (HTML 페이지 직접 접근 방지)
      // /api, /gw/api/files, 정적 assets는 제외
      const isApiPath = req.originalUrl.startsWith('/api');
      const isGwFilesPath = req.originalUrl.startsWith('/gw/api/files');
      const isStaticAsset = req.originalUrl.includes('/assets/') ||
                            req.originalUrl.endsWith('.js') ||
                            req.originalUrl.endsWith('.css') ||
                            req.originalUrl.endsWith('.woff') ||
                            req.originalUrl.endsWith('.woff2') ||
                            req.originalUrl.endsWith('.ttf');

      if (!isApiPath && !isGwFilesPath && !isStaticAsset) {
        const referer = req.headers['referer'];
        // referer가 없는 HTML 요청 = 주소창 직접 접근
        if (!referer) {
          _reply.code(401).send('Unauthorized - direct access not allowed');
          logger.error('req.originalUrl: ' + req.originalUrl + ' - Unauthorized - direct access not allowed');
          return;
        }
      }

      // 제외 경로: 워크스페이스 필요 없음
      const excludedPaths = [
        '/api/auth/setup',
        '/api/health',
        '/api/auth/auto-login',
        '/api/gw/files/',
      ];

      if (
        req.originalUrl.startsWith('/api') &&
        !excludedPaths.some((path) => req.originalUrl.startsWith(path))
      ) {
        if (!req.raw?.['workspaceId'] && req.originalUrl !== '/api') {
          throw new NotFoundException('Workspace not found');
        }
        done();
      } else {
        done();
      }
    });

  // 파이프/인터셉터/후킹
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      stopAtFirstError: true,
      transform: true,
    }),
  );

  // Exception Filter 등록 (모든 예외 자동 로깅)
  app.useGlobalFilters(new AllExceptionsFilter());

  // 같은 오리진이면 CORS는 크게 의미 없지만 기본 허용
  app.enableCors();
  app.useGlobalInterceptors(new TransformHttpResponseInterceptor(reflector));
  app.enableShutdownHooks();

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`UnhandledRejection, reason: ${reason}`, promise);
  });

  process.on('uncaughtException', (error) => {
    logger.error('UncaughtException:', error);
  });

  // 리슨
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0', () => {
    logger.log(`Listening on http://127.0.0.1:${port} / ${process.env.APP_URL}`);
    logger.log(`NODE_ENV = ${process.env.NODE_ENV ?? 'development'}`);
  });
}

bootstrap();