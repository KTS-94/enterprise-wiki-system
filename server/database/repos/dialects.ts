// apps/server/src/database/repos/dialects.ts
import { sql, Expression, Kysely } from 'kysely';

export type DatabaseDialect = 'mysql' | 'postgres' | 'oracle' | 'tibero' | 'unknown';

export interface DialectAdapter {
  // JSON 직렬화/역직렬화 (MariaDB/CLOB 대비)
  jsonIn(v: unknown): string;             // 앱→DB
  jsonOut<T>(v: unknown, fallback: T): T; // DB→앱

  // 대소문자 무시 LIKE
  iLike(columnSql: Expression<any>, pattern: string): Expression<boolean>;

  // 검색 (score 식과 where 식을 함께 제공)
  buildSearch(tableAlias: string, cols: string[], term: string): {
    score: Expression<number>;
    where: Expression<boolean>;
    orderBy?: { column: Expression<any>, direction: 'asc'|'desc' }[];
  };

  // UPSERT
  upsert<T extends Record<string, any>>(db: Kysely<any>, table: string, row: T, keys: (keyof T)[], updateCols: (keyof T)[]): any;
}
