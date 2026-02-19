# 멀티 DB 전략

## 개요

단일 코드베이스에서 MySQL/MariaDB, PostgreSQL, Oracle을 모두 지원합니다. Kysely ORM이 쿼리 빌더 기반을 제공하고, 커스텀 추상화 레이어가 DB별 차이를 처리합니다.

```
                    ┌──────────────────┐
                    │   Kysely ORM     │
                    │  (Query Builder) │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌───────────┐ ┌─────────────┐
     │ MySQL/MariaDB│ │ PostgreSQL│ │   Oracle     │
     │   (내장)     │ │  (내장)   │ │ (직접 구현)  │
     ├──────────────┤ ├───────────┤ ├─────────────┤
     │ JSON_OBJECT  │ │ jsonb     │ │ 문자열 연결  │
     │ FULLTEXT     │ │ tsvector  │ │ LIKE 폴백   │
     │ MATCH AGAINST│ │ ts_rank   │ │ ROWNUM 페이징│
     │ utf8mb4      │ │ INT8 파싱 │ │ Thick/Thin  │
     └──────────────┘ └───────────┘ └─────────────┘
```

## Oracle Dialect (`oracle.dialect.ts` — 662줄)

Kysely는 공식적으로 MySQL, PostgreSQL, SQLite만 지원합니다. Oracle Dialect를 Kysely의 플러그인 아키텍처에 맞춰 처음부터 직접 구현했습니다.

### 핵심 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| `OracleDialect` | Kysely의 `Dialect` 인터페이스를 구현하는 메인 클래스 |
| `OracleDriver` | `oracledb` 라이브러리 기반 커넥션 관리 |
| `OracleIntrospector` | Oracle 카탈로그 테이블 기반 스키마 인트로스펙션 |
| `OracleQueryCompiler` | Oracle 전용 SQL 구문 생성 |
| `OracleAdapter` | 결과셋 변환 및 타입 매핑 |

### Oracle 버전별 처리

```typescript
// Oracle 11g: Instant Client가 필요한 Thick 모드
if (config.version === '11g') {
  oracledb.initOracleClient({ libDir: config.instantClientPath });
}

// Oracle 12c+: 네이티브 의존성 없는 Thin 모드 사용
// 기본 동작, 별도 초기화 불필요
```

### 페이징

```sql
-- MySQL/PostgreSQL:
SELECT * FROM pages LIMIT 10 OFFSET 20

-- Oracle 12c+:
SELECT * FROM pages OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY

-- Oracle 11g:
SELECT * FROM (
  SELECT t.*, ROWNUM rn FROM (
    SELECT * FROM pages ORDER BY created_at
  ) t WHERE ROWNUM <= 30
) WHERE rn > 20
```

## QueryBuilder (`query-builder.ts` — 375줄)

`QueryBuilder`는 DB별 차이를 통합하는 단일 인터페이스를 제공합니다.

### JSON 빌드

각 DB마다 JSON 객체 생성 방식이 다릅니다:

```sql
-- MySQL:
JSON_OBJECT('id', u.user_id, 'name', u.display_name)

-- PostgreSQL:
json_build_object('id', u.user_id, 'name', u.display_name)

-- Oracle 12c+:
JSON_OBJECT('id' VALUE u.user_id, 'name' VALUE u.display_name)

-- Oracle 11g:
'{"id":"' || u.user_id || '","name":"' || u.display_name || '"}'
```

`JsonBuilder` 추상화가 이를 정규화합니다:

```typescript
const json = queryBuilder.jsonObject({
  id: 'u.user_id',
  name: 'u.display_name',
});
// 현재 DB에 맞는 올바른 SQL을 생성
```

### 전문 검색

```sql
-- PostgreSQL: tsvector + ts_rank
WHERE to_tsvector('simple', title) @@ plainto_tsquery('simple', ?)
ORDER BY ts_rank(to_tsvector('simple', title), plainto_tsquery('simple', ?)) DESC

-- MySQL: FULLTEXT 인덱스 + MATCH AGAINST
WHERE MATCH(title, content) AGAINST(? IN BOOLEAN MODE)
ORDER BY MATCH(title, content) AGAINST(? IN BOOLEAN MODE) DESC

-- Oracle: LIKE 폴백 (FTS 인덱스 불필요)
WHERE LOWER(title) LIKE LOWER('%' || ? || '%')
   OR LOWER(content) LIKE LOWER('%' || ? || '%')
```

## 테이블 네임 매퍼 (`table-name-mapper.plugin.ts` — 166줄)

엔터프라이즈 환경에서는 스키마 프리픽스가 붙은 테이블명을 사용하는 경우가 많습니다. 매퍼 플러그인이 Kysely 쿼리를 가로채어 DB 타입과 설정에 따라 올바른 스키마 프리픽스를 적용합니다.

```typescript
// 설정:
DB_WIKI_SCHEMA=covi_wiki      // 위키 테이블 스키마
DB_GW_SCHEMA=covi_smart4j     // 그룹웨어 테이블 스키마

// 결과:
'wiki_pages'       → 'covi_wiki.wiki_pages'
'sys_object_user'  → 'covi_smart4j.sys_object_user'

// Oracle은 기본 스키마가 다름:
'wiki_pages'       → 'gwuser.wiki_pages'
```

## Dialect 레지스트리 (`dialects.ts`, `dialects-oracle.ts`)

`DATABASE_URL` 프로토콜에 따라 시작 시 Dialect가 자동 선택됩니다:

```
mysql://...    → MysqlDialect (Kysely 내장)
postgres://... → PostgresDialect (Kysely 내장)
oracle://...   → OracleDialect (커스텀)
```

Oracle Dialect는 별도 파일(`dialects-oracle.ts`)로 분리하여 Oracle을 사용하지 않을 때 `oracledb` 의존성을 트리 셰이킹할 수 있도록 했습니다.

## DB 클러스터링 지원

MySQL/MariaDB의 경우 라운드 로빈 분배 방식의 멀티 노드 클러스터링을 지원합니다:

```
애플리케이션
     │
     ▼
라운드 로빈 분배
     │
     ├──▶ Node 1 (CLUSTERING_DB_HOST_1)
     ├──▶ Node 2 (CLUSTERING_DB_HOST_2)
     └──▶ Node 3 (CLUSTERING_DB_HOST_3)

■ 노드 장애: 5회 연속 에러 후 자동 제외
■ 복구 감지: 30초마다 헬스체크 후 자동 복귀
■ 커넥션 풀: 전체 풀 사이즈를 노드 수로 균등 분배
```

환경변수로 설정:
```
DB_CLUSTERING=Y
CLUSTERING_DB_HOST_1=192.168.1.1
CLUSTERING_DB_HOST_2=192.168.1.2
CLUSTERING_DB_PORT=3306
CLUSTERING_DB_USER=wikiuser
CLUSTERING_DB_NAME=covi_wiki
```
