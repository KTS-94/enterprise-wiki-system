/**
 * @modified from Docmost (AGPL-3.0) - environment.service.ts
 * @see https://github.com/docmost/docmost
 *
 * Additions (~180 lines added to original ~165 lines):
 *  - Redis Sentinel mode support (getRedisConfig)
 *  - DB clustering configuration (lines 174-225)
 *  - DB schema/prefix management for multi-schema deployment (lines 227-274)
 *  - Oracle Instant Client path (lines 276-284)
 *  - Granular debug/log level controls (lines 286-329)
 *  - Collaboration document TTL (lines 331-339)
 *  - Page password salt (lines 166-172)
 *  - Resource versioning (lines 341-343)
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import {
  RedisConfig,
  RedisSingleConfig,
  RedisSentinelConfig,
} from '../../common/helpers';

@Injectable()
export class EnvironmentService {
  constructor(private configService: ConfigService) {}

  getNodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  getAppUrl(): string {
    const rawUrl =
      this.configService.get<string>('APP_URL') ||
      `http://localhost:${this.getPort()}`;

    const { origin } = new URL(rawUrl);
    return origin;
  }

  isHttps(): boolean {
    const appUrl = this.configService.get<string>('APP_URL');
    try {
      const url = new URL(appUrl);
      return url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  getPort(): number {
    return parseInt(this.configService.get<string>('PORT', '3000'));
  }

  getAppSecret(): string {
    return this.configService.get<string>('APP_SECRET');
  }

  getDatabaseURL(): string {
    return this.configService.get<string>('DATABASE_URL');
  }

  getDatabaseMaxPool(): number {
    return parseInt(this.configService.get<string>('DATABASE_MAX_POOL', '10'));
  }

  getRedisConfig(): RedisConfig {
    const mode = this.configService.get<string>('REDIS_MODE', 'single');

    if (mode.trim() === 'single') {
      const config: RedisSingleConfig = {
        mode: 'single',
        host: this.configService.get<string>('REDIS_HOST', '127.0.0.1'),
        port: Number(this.configService.get<string>('REDIS_PORT', '6379')),
        db: Number(this.configService.get<string>('REDIS_DB', '0')),
        password: this.configService.get<string>('REDIS_PASSWORD', ''),
        family: Number(this.configService.get<string>('REDIS_FAMILY', '4')),
      };
      return config;
    }

    // sentinel
    const sentinels = [
      this.configService.get<string>('REDIS_SENTINEL_1'),
      this.configService.get<string>('REDIS_SENTINEL_2'),
      this.configService.get<string>('REDIS_SENTINEL_3'),
    ]
      .filter(Boolean)
      .map((host) => ({
        host,
        port: Number(
          this.configService.get<string>('REDIS_SENTINEL_PORT', '26379'),
        ),
      }));

    const config: RedisSentinelConfig = {
      mode: 'sentinel',
      masterName: this.configService.get<string>(
        'REDIS_MASTER_NAME',
        'mymaster',
      ),
      password: this.configService.get<string>('REDIS_PASSWORD', ''),
      db: Number(this.configService.get<string>('REDIS_DB', '0')),
      sentinels,
    };

    return config;
  }

  getJwtTokenExpiresIn(): string {
    return this.configService.get<string>('JWT_TOKEN_EXPIRES_IN', '90d');
  }

  getCookieExpiresIn(): Date {
    const expiresInStr = this.getJwtTokenExpiresIn();
    let msUntilExpiry: number;
    try {
      msUntilExpiry = ms(expiresInStr as StringValue);
    } catch (err) {
      msUntilExpiry = ms('90d');
    }
    return new Date(Date.now() + msUntilExpiry);
  }

  getStorageDriver(): string {
    return this.configService.get<string>('STORAGE_DRIVER', 'local');
  }

  getFileUploadSizeLimit(): string {
    return this.configService.get<string>('FILE_UPLOAD_SIZE_LIMIT', '50mb');
  }

  getFileImportSizeLimit(): string {
    return this.configService.get<string>('FILE_IMPORT_SIZE_LIMIT', '200mb');
  }

  getAwsS3AccessKeyId(): string {
    return this.configService.get<string>('AWS_S3_ACCESS_KEY_ID');
  }

  getAwsS3SecretAccessKey(): string {
    return this.configService.get<string>('AWS_S3_SECRET_ACCESS_KEY');
  }

  getAwsS3Region(): string {
    return this.configService.get<string>('AWS_S3_REGION');
  }

  getAwsS3Bucket(): string {
    return this.configService.get<string>('AWS_S3_BUCKET');
  }

  getAwsS3Endpoint(): string {
    return this.configService.get<string>('AWS_S3_ENDPOINT');
  }

  getAwsS3ForcePathStyle(): boolean {
    return this.configService.get<boolean>('AWS_S3_FORCE_PATH_STYLE');
  }

  getAwsS3Url(): string {
    return this.configService.get<string>('AWS_S3_URL');
  }

  getDrawioUrl(): string {
    return this.configService.get<string>('DRAWIO_URL');
  }

  getCollabUrl(): string {
    return this.configService.get<string>('COLLAB_URL');
  }

  isCollabDisableRedis(): boolean {
    const isStandalone = this.configService
      .get<string>('COLLAB_DISABLE_REDIS', 'false')
      .toLowerCase();
    return isStandalone === 'true';
  }

  /**
   * 페이지 비밀번호 해싱용 글로벌 솔트 키
   * SHA-512 해시 생성 시 사용됨
   */
  getPagePasswordSalt(): string {
    return this.configService.get<string>('PAGE_PASSWORD_SALT', '');
  }

  // ===== DB 클러스터링 설정 =====

  /**
   * DB 클러스터링 활성화 여부
   */
  isDbClusteringEnabled(): boolean {
    const value = this.configService.get<string>('DB_CLUSTERING', 'N');
    return value?.toUpperCase() === 'Y';
  }

  /**
   * 클러스터링 DB 호스트 목록 반환
   * CLUSTERING_DB_HOST_1 ~ CLUSTERING_DB_HOST_10 형식 지원
   */
  getClusteringDbHosts(): string[] {
    const hosts: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const host = this.configService.get<string>(`CLUSTERING_DB_HOST_${i}`, '');
      if (host) {
        hosts.push(host);
      }
    }
    return hosts;
  }

  /**
   * 클러스터링 DB 포트
   */
  getClusteringDbPort(): number {
    return parseInt(this.configService.get<string>('CLUSTERING_DB_PORT', '3306'));
  }

  /**
   * 클러스터링 DB 사용자
   */
  getClusteringDbUser(): string {
    return this.configService.get<string>('CLUSTERING_DB_USER', '');
  }

  /**
   * 클러스터링 DB 비밀번호
   */
  getClusteringDbPassword(): string {
    return this.configService.get<string>('CLUSTERING_DB_PASSWD', '');
  }

  /**
   * 클러스터링 DB 이름
   */
  getClusteringDbName(): string {
    return this.configService.get<string>('CLUSTERING_DB_NAME', '');
  }

  // ===== DB 테이블 스키마/프리픽스 설정 =====

  /**
   * Wiki 테이블 스키마 (예: covi_wiki, gwuser)
   * 기본값은 DB 타입에 따라 다름
   */
  getDbWikiSchema(): string {
    const schema = this.configService.get<string>('DB_WIKI_SCHEMA', '');
    if (schema) return schema;

    // 기본값: DB 타입에 따라 결정
    const dbUrl = this.getDatabaseURL() || '';
    if (dbUrl.startsWith('oracle')) return 'gwuser';
    return 'covi_wiki'; // MySQL/MariaDB, PostgreSQL
  }

  /**
   * 그룹웨어 테이블 스키마 (예: covi_smart4j, gwuser)
   */
  getDbGwSchema(): string {
    const schema = this.configService.get<string>('DB_GW_SCHEMA', '');
    if (schema) return schema;

    // 기본값: DB 타입에 따라 결정
    const dbUrl = this.getDatabaseURL() || '';
    if (dbUrl.startsWith('oracle')) return 'gwuser';
    return 'covi_smart4j'; // MySQL/MariaDB, PostgreSQL
  }

  /**
   * Wiki 테이블의 전체 이름 생성
   * @param tableName 테이블명 (예: wiki_pages)
   * @returns 스키마 포함 테이블명 (예: covi_wiki.wiki_pages)
   */
  getWikiTableName(tableName: string): string {
    const schema = this.getDbWikiSchema();
    return schema ? `${schema}.${tableName}` : tableName;
  }

  /**
   * 그룹웨어 테이블의 전체 이름 생성
   * @param tableName 논리적 테이블명 (예: sys_object_user)
   * @returns 물리적 테이블명 (예: covi_smart4j.sys_object_user)
   */
  getGwTableName(tableName: string): string {
    const schema = this.getDbGwSchema();
    return schema ? `${schema}.${tableName}` : tableName;
  }

  /**
   * Oracle Instant Client 경로 (Oracle 11g Thick 모드용)
   * 환경변수: ORACLE_INSTANT_CLIENT_PATH
   * 예: C:\oracle\instantclient_19_8 (Windows)
   *     /usr/lib/oracle/19.8/client64/lib (Linux)
   */
  getOracleInstantClientPath(): string | undefined {
    return this.configService.get<string>('ORACLE_INSTANT_CLIENT_PATH');
  }

  // ===== 로그/디버그 설정 =====

  /**
   * 전역 로그 레벨
   * LOG_LEVEL: error | warn | log | debug | verbose
   * 기본값: development=debug, production=log
   */
  getLogLevel(): string {
    const level = this.configService.get<string>('LOG_LEVEL', '');
    if (level) return level;
    return this.getNodeEnv() === 'production' ? 'log' : 'debug';
  }

  /**
   * DB 쿼리 디버그 로그 활성화
   * DEBUG_DB=true
   */
  isDebugDb(): boolean {
    return this.configService.get<string>('DEBUG_DB', 'false').toLowerCase() === 'true';
  }

  /**
   * Redis 디버그 로그 활성화
   * DEBUG_REDIS=true
   */
  isDebugRedis(): boolean {
    return this.configService.get<string>('DEBUG_REDIS', 'false').toLowerCase() === 'true';
  }

  /**
   * Collaboration(Hocuspocus) 디버그 로그 활성화
   * DEBUG_COLLAB=true
   */
  isDebugCollab(): boolean {
    return this.configService.get<string>('DEBUG_COLLAB', 'false').toLowerCase() === 'true';
  }

  /**
   * WebSocket 디버그 로그 활성화
   * DEBUG_WS=true
   */
  isDebugWs(): boolean {
    return this.configService.get<string>('DEBUG_WS', 'false').toLowerCase() === 'true';
  }

  // ===== Collaboration 설정 =====

  /**
   * Collaboration 문서 상태 Redis TTL (초)
   * COLLAB_DOC_TTL=3600 (기본: 1시간)
   */
  getCollabDocTTL(): number {
    return parseInt(this.configService.get<string>('COLLAB_DOC_TTL', '3600'), 10);
  }

  getResourceVersion(): string {
    return this.configService.get<string>('RESOURCE_VERSION', '0');
  }

}
