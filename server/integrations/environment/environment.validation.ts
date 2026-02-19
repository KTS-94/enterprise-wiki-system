/**
 * @modified from Docmost (AGPL-3.0) - environment.validation.ts
 * @see https://github.com/docmost/docmost
 *
 * Additions (~30 lines added to original ~55 lines):
 *  - Oracle/OracleDB protocol support in DATABASE_URL validation (line 19)
 *  - DB clustering env vars: DB_CLUSTERING, CLUSTERING_DB_HOST_1..5, PORT, USER, PASSWD, NAME (lines 27-68)
 *  - DB schema configuration: DB_WIKI_SCHEMA, DB_GW_SCHEMA (lines 69-78)
 *  - RESOURCE_VERSION field (lines 119-121)
 */
import {
  IsIn,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsUrl,
  MinLength,
  ValidateIf,
  validateSync,
  IsPort,
  IsString,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';

export class EnvironmentVariables {
  @IsNotEmpty()
  @IsUrl(
    {
      protocols: ['postgres', 'postgresql', 'mysql', 'mariadb', 'oracle', 'oracledb'],
      require_tld: false,
      allow_underscores: true,
    },
    { message: 'DATABASE_URL must be a valid connection string' },
  )
  DATABASE_URL: string;

  // ===== DB 클러스터링 설정 =====
  @IsOptional()
  @IsIn(['Y', 'N', 'y', 'n', ''])
  DB_CLUSTERING?: string;

  // 개별 호스트 지정 (HOST_1, HOST_2, ... HOST_10 까지 지원)
  @IsOptional()
  @IsString()
  CLUSTERING_DB_HOST_1?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_HOST_2?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_HOST_3?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_HOST_4?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_HOST_5?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_PORT?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_USER?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_PASSWD?: string;

  @IsOptional()
  @IsString()
  CLUSTERING_DB_NAME?: string;

  // ===== DB 테이블 스키마/프리픽스 설정 =====
  // Wiki 테이블 스키마 (예: covi_wiki, gwuser, public)
  @IsOptional()
  @IsString()
  DB_WIKI_SCHEMA?: string;

  // 그룹웨어 테이블 스키마 (예: covi_smart4j, gwuser)
  @IsOptional()
  @IsString()
  DB_GW_SCHEMA?: string;

  @IsOptional()
  @IsUrl(
    {
      protocols: ['redis', 'rediss'],
      require_tld: false,
      allow_underscores: true,
    },
    { message: 'REDIS_URL must be a valid redis connection string' },
  )
  REDIS_URL?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  APP_URL: string;

  @IsNotEmpty()
  @MinLength(32)
  @IsNotIn(['REPLACE_WITH_LONG_SECRET'])
  APP_SECRET: string;

  @IsOptional()
  @IsIn(['local', 's3'])
  STORAGE_DRIVER: string;

  @IsOptional()
  @ValidateIf((obj) => obj.COLLAB_URL != '' && obj.COLLAB_URL != null)
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  COLLAB_URL: string;

  @IsOptional()
  @IsUrl(
    { protocols: [], require_tld: true },
    {
      message:
        'SUBDOMAIN_HOST must be a valid FQDN domain without the http protocol. e.g example.com',
    },
  )
  SUBDOMAIN_HOST: string;

  @IsOptional()
  @IsString()
  RESOURCE_VERSION?: string;
}

export function validate(config: Record<string, any>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(validatedConfig);

  if (errors.length > 0) {
    console.error('The Environment variables has failed the following validations:');

    errors.map((error) => {
      console.error(JSON.stringify(error.constraints));
    });

    console.error('Please fix the environment variables and try again. Exiting program...');
    process.exit(1);
  }

  return validatedConfig;
}
