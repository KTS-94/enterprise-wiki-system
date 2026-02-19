// src/collaboration/extensions/redis-sync.extension.ts

import {
  Extension,
  onChangePayload,
  afterUnloadDocumentPayload,
  onConfigurePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
  onAwarenessUpdatePayload,
} from '@hocuspocus/server';
import IORedis from 'ioredis';
import * as Y from 'yjs';
import {
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from 'y-protocols/awareness';
import {
  createRetryStrategy,
  RedisConfig,
} from '../../common/helpers';
import { Logger } from '@nestjs/common';

interface RedisSyncExtensionConfig {
  redis: RedisConfig;
  /** 문서 업데이트 pub/sub 채널 (기본: 'coviwiki:yjs:updates') */
  channel?: string;
  /** Awareness pub/sub 채널 (기본: 'coviwiki:yjs:awareness') */
  awarenessChannel?: string;
  /** 문서 상태 Redis 저장 키 prefix (기본: 'coviwiki:doc:') */
  docKeyPrefix?: string;
  /** 문서 상태 Redis TTL (초, 기본: 3600 = 1시간, 환경변수: COLLAB_DOC_TTL) */
  docTTL?: number;
  /** 디버그 모드 (기본: DEBUG_REDIS 환경변수 참조) */
  debug?: boolean;
}

export class RedisSyncExtension implements Extension {
  private readonly logger = new Logger(RedisSyncExtension.name);
  private readonly debug: boolean;
  private pub: IORedis;
  private sub: IORedis;
  private readonly channel: string;
  private readonly awarenessChannel: string;
  private readonly docKeyPrefix: string;
  private readonly docTTL: number;
  private readonly nodeId: string;
  private instance: any | null = null; // Hocuspocus 인스턴스 (타입에 메서드가 안 떠서 any로)

  /**
   * Redis에서 받은 awareness 업데이트를 처리 중인지 추적
   * - 루프 방지: Redis에서 받은 업데이트가 다시 Redis로 전파되는 것을 방지
   */
  private processingRemoteAwareness: Set<string> = new Set();

  /**
   * Redis를 통해 수신된 원격 클라이언트 ID 추적 (문서별)
   * - 타임아웃 제거 시 로컬 vs 원격 클라이언트를 구분하기 위해 사용
   * - 원격 클라이언트의 타임아웃 제거는 Redis로 전파하지 않음
   */
  private remoteClientIds: Map<string, Set<number>> = new Map();

  constructor(config: RedisSyncExtensionConfig) {
    this.debug = config.debug ?? process.env.DEBUG_REDIS?.toLowerCase() === 'true';
    this.channel = config.channel ?? 'coviwiki:yjs:updates';
    this.awarenessChannel = config.awarenessChannel ?? 'coviwiki:yjs:awareness';
    this.docKeyPrefix = config.docKeyPrefix ?? 'coviwiki:doc:';
    // TTL: 환경변수 > config > 기본값(1시간)
    this.docTTL = config.docTTL
      ?? parseInt(process.env.COLLAB_DOC_TTL || '3600', 10); // 1시간
    this.nodeId =
      process.env.HOSTNAME ||
      `node-${Math.random().toString(36).slice(2, 8)}`;

    const redisOptions =
      config.redis.mode === 'single'
        ? {
            host: config.redis.host,
            port: config.redis.port,
            db: config.redis.db,
            password: config.redis.password || undefined,
            family: config.redis.family,
            retryStrategy: createRetryStrategy(),
          }
        : {
            sentinels: config.redis.sentinels,
            name: config.redis.masterName,
            db: config.redis.db,
            password: config.redis.password || undefined,
            retryStrategy: createRetryStrategy(),
          };

    this.pub = new IORedis(redisOptions);
    this.sub = new IORedis(redisOptions);

    // Redis 연결 상태 모니터링 (pub)
    this.pub.on('connect', () => {
      this.logger.log('[Redis:pub] Connected');
    });
    this.pub.on('ready', () => {
      this.logger.log('[Redis:pub] Ready');
    });
    this.pub.on('error', (err) => {
      this.logger.error('[Redis:pub] Error', err.message);
    });
    this.pub.on('close', () => {
      this.logger.warn('[Redis:pub] Connection closed');
    });
    this.pub.on('reconnecting', (delay: number) => {
      this.logger.warn(`[Redis:pub] Reconnecting in ${delay}ms`);
    });

    // Redis 연결 상태 모니터링 (sub)
    this.sub.on('connect', () => {
      this.logger.log('[Redis:sub] Connected');
    });
    this.sub.on('ready', () => {
      this.logger.log('[Redis:sub] Ready - subscribing to channels');
      this.sub.subscribe(this.channel, this.awarenessChannel);
    });
    this.sub.on('error', (err) => {
      this.logger.error('[Redis:sub] Error', err.message);
    });
    this.sub.on('close', () => {
      this.logger.warn('[Redis:sub] Connection closed');
    });
    this.sub.on('reconnecting', (delay: number) => {
      this.logger.warn(`[Redis:sub] Reconnecting in ${delay}ms`);
    });
    this.sub.on('message', this.handleMessage.bind(this));

    this.logger.log(`RedisSyncExtension initialized (nodeId: ${this.nodeId}, mode: ${config.redis.mode}, debug: ${this.debug})`);
  }

  /** Redis에 저장된 문서 상태 키 생성 */
  private getDocKey(documentName: string): string {
    return `${this.docKeyPrefix}${documentName}`;
  }

  // Hocuspocus 인스턴스를 보관해 두기 위해 사용
  async onConfigure(payload: onConfigurePayload): Promise<void> {
    this.instance = payload.instance;
  }

  /**
   * 문서 로드 시 Redis에서 최신 상태 확인
   * - Redis에 상태가 있으면 해당 상태를 문서에 병합
   * - 다른 Pod에서 아직 DB에 저장하지 않은 변경사항도 반영됨
   */
  async onLoadDocument(payload: onLoadDocumentPayload): Promise<void> {
    const { documentName, document } = payload;
    const docKey = this.getDocKey(documentName);

    try {
      const redisState = await this.pub.getBuffer(docKey);

      if (redisState && redisState.length > 0) {
        if (this.debug) {
          // production에서도 출력되도록 log 레벨 사용
          this.logger.log(`[DEBUG] [${documentName}] Redis에서 문서 상태 로드 (${redisState.length} bytes)`);
        }

        // Redis 상태를 현재 문서에 병합 (DB에서 로드된 상태와 병합됨)
        Y.applyUpdate(document, new Uint8Array(redisState), 'redis-sync');
      }
    } catch (e) {
      this.logger.warn(`[${documentName}] Redis 문서 상태 로드 실패`, e);
    }
  }

  /**
   * 문서 저장 시 Redis에도 상태 저장
   * - 모든 Pod가 동일한 최신 상태를 공유할 수 있도록
   */
  async onStoreDocument(payload: onStoreDocumentPayload): Promise<void> {
    const { documentName, document } = payload;
    const docKey = this.getDocKey(documentName);

    try {
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      await this.pub.setex(docKey, this.docTTL, state);
      if (this.debug) {
        this.logger.log(`[DEBUG] [${documentName}] Redis에 문서 상태 저장 (${state.length} bytes)`);
      }
    } catch (e) {
      this.logger.warn(`[${documentName}] Redis 문서 상태 저장 실패`, e);
    }
  }

  // 로컬에서 문서 변경이 발생했을 때 → Redis로 전파
  async onChange(payload: onChangePayload): Promise<void> {
    // Redis에서 들어온 변경은 다시 내보내지 않기 위해 origin 체크
    if (payload.transactionOrigin === 'redis-sync') return;

    const { documentName, document } = payload;
    const docKey = this.getDocKey(documentName);

    // 1. 변경된 문서 전체 상태를 Redis에 저장 (다른 Pod 초기 로드용)
    try {
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      await this.pub.setex(docKey, this.docTTL, state);
    } catch (e) {
      // 상태 저장 실패해도 pub/sub은 계속 진행
    }

    // 2. 증분 업데이트를 pub/sub으로 전파 (이미 문서 열고 있는 Pod용)
    const message = {
      nodeId: this.nodeId,
      documentName: payload.documentName,
      update: Buffer.from(payload.update).toString('base64'),
    };

    try {
      await this.pub.publish(this.channel, JSON.stringify(message));
    } catch (e) {
      // 필요하면 로깅
      // console.error('[RedisSyncExtension] publish error', e);
    }
  }

  /**
   * Awareness 변경 시 다른 Pod로 전파
   * - 접속자 정보(cursor 위치, 사용자 정보 등)를 다른 Pod에서도 볼 수 있도록
   * - y-protocols의 encodeAwarenessUpdate를 사용하여 표준 방식으로 인코딩
   * - 새 클라이언트 추가 시 전체 awareness 상태를 브로드캐스트 (멀티 Pod 동기화)
   */
  async onAwarenessUpdate(payload: onAwarenessUpdatePayload): Promise<void> {
    const { documentName, awareness, added, updated, removed } = payload;

    // Redis에서 받은 awareness 업데이트 처리 중이면 다시 Redis로 보내지 않음 (루프 방지)
    if (this.processingRemoteAwareness.has(documentName)) {
      return;
    }

    // removed에서 원격 클라이언트(타임아웃) vs 로컬 클라이언트(실제 퇴장) 구분
    const remoteIds = this.remoteClientIds.get(documentName);
    const localRemoved = removed.filter((id) => !remoteIds?.has(id));
    const remoteRemoved = removed.filter((id) => remoteIds?.has(id));

    // 원격 클라이언트 타임아웃 제거 시 추적에서도 제거
    if (remoteIds && remoteRemoved.length > 0) {
      for (const id of remoteRemoved) remoteIds.delete(id);
      if (this.debug) {
        this.logger.log(
          `[DEBUG] [${documentName}] Remote awareness timeout skipped: -${remoteRemoved.length}`
        );
      }
    }

    // 변경된 클라이언트 ID 목록 (원격 타임아웃 제거는 제외)
    const changedClients = [...added, ...updated, ...localRemoved];
    if (changedClients.length === 0) return;

    try {
      // 새 클라이언트가 추가되면 전체 awareness 상태를 브로드캐스트
      // (다른 Pod의 기존 클라이언트들이 새 클라이언트를 즉시 볼 수 있도록)
      let clientsToSend: number[];
      if (added.length > 0) {
        // 전체 클라이언트 목록 전송 (새 연결 시 멀티 Pod 동기화)
        const states = awareness.getStates();
        clientsToSend = Array.from(states.keys()) as number[];
      } else {
        // 변경된 클라이언트만 전송
        clientsToSend = changedClients;
      }

      // y-protocols/awareness의 encodeAwarenessUpdate를 사용하여 표준 방식으로 인코딩
      const awarenessUpdate = encodeAwarenessUpdate(awareness, clientsToSend);

      const message = {
        nodeId: this.nodeId,
        documentName,
        update: Buffer.from(awarenessUpdate).toString('base64'),
      };

      await this.pub.publish(this.awarenessChannel, JSON.stringify(message));

      if (this.debug) {
        this.logger.log(
          `[DEBUG] [${documentName}] Awareness sent: +${added.length} ~${updated.length} -${removed.length} (total: ${clientsToSend.length}, ${awarenessUpdate.length} bytes)`
        );
      }
    } catch (e) {
      // 필요하면 로깅
      if (this.debug) {
        this.logger.warn(`[DEBUG] [${documentName}] Failed to send awareness update`, e);
      }
    }
  }

  // 다른 서버에서 온 변경을 현재 서버의 문서에 적용
  private async handleMessage(channel: string, message: string) {
    // 문서 업데이트 처리
    if (channel === this.channel) {
      await this.handleDocumentUpdate(message);
      return;
    }

    // Awareness 업데이트 처리
    if (channel === this.awarenessChannel) {
      await this.handleAwarenessUpdate(message);
      return;
    }
  }

  /** 문서 업데이트 메시지 처리 */
  private async handleDocumentUpdate(message: string) {
    let decoded: {
      nodeId: string;
      documentName: string;
      update: string;
    };

    try {
      decoded = JSON.parse(message);
    } catch {
      return;
    }

    if (decoded.nodeId === this.nodeId) {
      // 내가 보낸 메시지면 무시
      return;
    }

    const update = Buffer.from(decoded.update, 'base64');
    const documentName = decoded.documentName;

    // Hocuspocus 인스턴스의 documents Map에서 문서 가져오기
    const documents = (this.instance as any)?.documents as Map<string, any>;
    if (!documents) {
      if (this.debug) {
        this.logger.log(`[DEBUG] [${documentName}] No documents map available`);
      }
      return;
    }

    const doc = documents.get(documentName);
    if (!doc) {
      // 해당 Pod에서 문서가 열려있지 않으면 skip (정상 상황)
      if (this.debug) {
        this.logger.log(`[DEBUG] [${documentName}] Document not loaded in this pod, skipping update from ${decoded.nodeId}`);
      }
      return;
    }

    try {
      // 문서에 업데이트 적용
      Y.applyUpdate(doc, update, 'redis-sync');

      if (this.debug) {
        this.logger.log(`[DEBUG] [${documentName}] Applied update from ${decoded.nodeId} (${update.length} bytes)`);
      }
    } catch (e) {
      this.logger.error(`[${documentName}] Failed to apply update from ${decoded.nodeId}`, e);
    }
  }

  /** Awareness 업데이트 메시지 처리 */
  private async handleAwarenessUpdate(message: string) {
    let decoded: {
      nodeId: string;
      documentName: string;
      update: string;
    };

    try {
      decoded = JSON.parse(message);
    } catch {
      return;
    }

    if (decoded.nodeId === this.nodeId) {
      // 내가 보낸 메시지면 무시
      return;
    }

    // Hocuspocus 인스턴스에서 해당 문서의 awareness 가져오기
    const documents = (this.instance as any)?.documents as Map<string, any>;
    if (!documents) {
      if (this.debug) {
        this.logger.log(`[DEBUG] [${decoded.documentName}] No documents map, skipping awareness from ${decoded.nodeId}`);
      }
      return;
    }

    const document = documents.get(decoded.documentName);
    if (!document?.awareness) {
      // 해당 문서가 이 Pod에서 열려있지 않음 - 정상 상황
      return;
    }

    try {
      // 플래그 설정: Redis에서 받은 업데이트가 다시 Redis로 전파되는 것을 방지
      this.processingRemoteAwareness.add(decoded.documentName);

      // 적용 전 상태 스냅샷 (원격 클라이언트 ID 추적용)
      const statesBefore = new Set(document.awareness.getStates().keys());

      // y-protocols/awareness의 applyAwarenessUpdate를 사용하여 표준 방식으로 적용
      // 이 함수는 내부적으로 awareness.emit('update', ...) 를 호출하여
      // Hocuspocus가 WebSocket 클라이언트들에게 전파할 수 있게 함
      const update = Buffer.from(decoded.update, 'base64');
      applyAwarenessUpdate(document.awareness, new Uint8Array(update), 'redis-sync');

      // 적용 후 새로 추가된 클라이언트 ID를 원격 클라이언트로 등록
      const statesAfter = document.awareness.getStates();
      if (!this.remoteClientIds.has(decoded.documentName)) {
        this.remoteClientIds.set(decoded.documentName, new Set());
      }
      const remoteIds = this.remoteClientIds.get(decoded.documentName);
      for (const clientId of statesAfter.keys()) {
        if (!statesBefore.has(clientId)) {
          remoteIds.add(clientId);
        }
      }

      if (this.debug) {
        this.logger.log(
          `[DEBUG] [${decoded.documentName}] Awareness applied from ${decoded.nodeId} (${update.length} bytes)`
        );
      }
    } catch (e) {
      this.logger.error(`[${decoded.documentName}] Failed to apply awareness from ${decoded.nodeId}`, e);
    } finally {
      // 플래그 해제
      this.processingRemoteAwareness.delete(decoded.documentName);
    }
  }

  async afterUnloadDocument({ documentName }: afterUnloadDocumentPayload): Promise<void> {
    this.remoteClientIds.delete(documentName);
  }

  async onDestroy(): Promise<void> {
    try {
      await this.sub.quit();
      await this.pub.quit();
    } catch {
      // ignore
    }
  }
}
