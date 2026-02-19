// apps/server/src/database/repos/dialects-oracle.ts
import { sql, Expression, Kysely } from 'kysely';
import type { DialectAdapter } from './dialects';

export const oracleAdapter: DialectAdapter = {
  // 보관은 CLOB/VARCHAR2 문자열 → 앱에서 JSON 파싱
  jsonIn(v) { return typeof v === 'string' ? v : JSON.stringify(v ?? {}); },
  jsonOut<T>(v, fb) {
    if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fb; } }
    return (v ?? fb) as T;
  },

  // ILIKE 없음 → LOWER 비교
  iLike(col, pattern) {
    return sql<boolean>`LOWER(${col}) LIKE LOWER(${pattern})`;
  },

  // Oracle Text (CTXSYS.CONTEXT) 가정
  // 다중 컬럼 검색은 MULTI_COLUMN_DATASTORE로 인덱스 구성 권장(아래 메모 참조)
  buildSearch(alias, cols, term) {
    const colTitle = sql.ref(`${alias}.${cols[0]}`);
    const colText  = sql.ref(`${alias}.${cols[1]}`);

    // 간단히 두 컬럼을 이어서 검색
    const joined = sql`(${colTitle} || ' ' || ${colText})`;
    const scoreExpr = sql<number>`SCORE(1)`;
    const whereExpr = sql<boolean>`CONTAINS(${joined}, ${term}, 1) > 0`;

    return {
      score: scoreExpr,
      where: whereExpr,
      orderBy: [{ column: scoreExpr as Expression<any>, direction: 'desc' }],
    };
  },

  // MERGE 기반 UPSERT
  upsert(db, table, row, keys, updateCols) {
    const cols = Object.keys(row);
    const vals = cols.map((k) => (row as any)[k]);

    const alias = sql.raw('t');
    const onCond = sql.raw(
      keys.map((k) => `t.${String(k)} = s.${String(k)}`).join(' AND ')
    );
    const setClause = sql.raw(
      updateCols.map((c) => `t.${String(c)} = s.${String(c)}`).join(', ')
    );

    // SELECT ... FROM dual 로 소스 만들기
    const selValues = sql.join(vals.map((v) => sql`${v}`));
    const colList   = sql.join(cols.map((c) => sql.ref(c)));

    return db.executeQuery(
      sql`
      MERGE INTO ${sql.ref(table)} ${alias}
      USING (SELECT ${selValues} FROM dual) s(${colList})
      ON (${onCond})
      WHEN MATCHED THEN UPDATE SET ${setClause}
      WHEN NOT MATCHED THEN INSERT (${colList}) VALUES (${selValues})
    ` as any);
  },
};
