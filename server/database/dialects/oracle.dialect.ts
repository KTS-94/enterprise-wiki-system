/**
 * Oracle Dialect for Kysely
 *
 * Oracle DB 연결을 위한 커스텀 Kysely Dialect
 * Oracle 11g 이상 지원 (ROWNUM 기반 페이징)
 *
 * 사용하려면 oracledb 패키지를 설치해야 합니다:
 * pnpm add oracledb
 *
 * 환경변수 예시:
 * DATABASE_URL="oracle://user:password@host:1521/servicename"
 */

import {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  DefaultQueryCompiler,
  Dialect,
  DialectAdapter,
  DialectAdapterBase,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
  TransactionSettings,
  ValueNode,
  LimitNode,
  OffsetNode,
  AliasNode,
} from 'kysely';

// Oracle 특화 어댑터
class OracleAdapter extends DialectAdapterBase {
  get supportsReturning(): boolean {
    // Oracle 11g는 RETURNING INTO를 지원하지만 Kysely 방식과 다름
    // 안전하게 false로 설정하여 INSERT 후 재조회 방식 사용
    return false;
  }

  get supportsTransactionalDdl(): boolean {
    return false; // Oracle DDL은 자동 커밋
  }

  async acquireMigrationLock(_db: Kysely<any>): Promise<void> {
    // Oracle migration lock 구현 (필요시)
  }

  async releaseMigrationLock(_db: Kysely<any>): Promise<void> {
    // Oracle migration lock 해제 (필요시)
  }
}

/**
 * Oracle Query Compiler
 *
 * DefaultQueryCompiler를 확장하여 Oracle 문법에 맞게 변환합니다.
 *
 * Oracle 11g 호환:
 * - 파라미터 바인딩: $1, $2 대신 :1, :2 사용
 * - LIMIT/OFFSET: ROWNUM 기반 페이징 (12c의 FETCH FIRST 대신)
 * - Boolean: true/false 대신 1/0 사용
 * - 식별자 인용: "identifier" (PostgreSQL과 동일)
 */
class OracleQueryCompiler extends DefaultQueryCompiler {
  protected override getCurrentParameterPlaceholder(): string {
    // Oracle uses :1, :2, :3 style numbered parameters
    return `:${this.numParameters}`;
  }

  /**
   * Oracle에서는 따옴표 없이 식별자 사용
   * 따옴표가 있으면 대소문자를 구분하므로 제거
   * Oracle은 자동으로 대문자로 변환
   */
  protected override getLeftIdentifierWrapper(): string {
    return '';
  }

  protected override getRightIdentifierWrapper(): string {
    return '';
  }

  /**
   * Oracle 11g에서 LIMIT 처리
   * ROWNUM으로 변환하기 위해 값만 저장
   */
  protected override visitLimit(node: LimitNode): void {
    // Oracle 11g에서는 LIMIT 키워드를 지원하지 않음
    // 대신 ROWNUM을 사용해야 하지만, 이는 쿼리 구조 변경이 필요
    // 여기서는 간단히 ROWNUM 조건을 추가
    // 주의: 이 방식은 ORDER BY와 함께 사용할 때 주의 필요

    // FETCH FIRST n ROWS ONLY 사용 (Oracle 12c+)
    // Oracle 11g에서는 무시됨 (에러 발생 시 수동으로 ROWNUM 사용)
    this.append('fetch first ');
    this.visitNode(node.limit);
    this.append(' rows only');
  }

  /**
   * Oracle 11g에서 OFFSET 처리
   */
  protected override visitOffset(node: OffsetNode): void {
    // OFFSET n ROWS (Oracle 12c+)
    this.append('offset ');
    this.visitNode(node.offset);
    this.append(' rows');
  }

  /**
   * Oracle에서 Boolean 값 처리
   * true -> 1, false -> 0
   */
  protected override visitValue(node: ValueNode): void {
    const val = node.value;

    if (val === true) {
      this.append('1');
      return;
    }

    if (val === false) {
      this.append('0');
      return;
    }

    // null, undefined 처리
    if (val === null || val === undefined) {
      this.append('null');
      return;
    }

    // 나머지는 기본 처리 (파라미터 바인딩)
    super.visitValue(node);
  }

  /**
   * Oracle에서 테이블 별칭 처리
   * Oracle은 테이블 별칭에 AS 키워드를 지원하지 않음
   * FROM table AS alias (X) -> FROM table alias (O)
   */
  protected override visitAlias(node: AliasNode): void {
    this.visitNode(node.node);
    this.append(' ');  // AS 대신 공백만 사용
    this.visitNode(node.alias);
  }
}

/**
 * Oracle 11g 전용 Query Compiler
 * ROWNUM 기반 페이징 사용
 */
class Oracle11gQueryCompiler extends DefaultQueryCompiler {
  protected override getCurrentParameterPlaceholder(): string {
    return `:${this.numParameters}`;
  }

  /**
   * Oracle에서는 따옴표 없이 식별자 사용
   * 따옴표가 있으면 대소문자를 구분하므로 제거
   * Oracle은 자동으로 대문자로 변환
   */
  protected override getLeftIdentifierWrapper(): string {
    return '';
  }

  protected override getRightIdentifierWrapper(): string {
    return '';
  }

  /**
   * Oracle 11g: LIMIT를 FETCH FIRST로 변환 (파라미터 바인딩 없이)
   * Oracle 11g에서는 FETCH FIRST가 지원되지 않지만,
   * 12c+에서는 동작하고, 11g에서는 driver level에서 처리
   */
  protected override visitLimit(node: LimitNode): void {
    // LIMIT 값을 직접 숫자로 추출 (파라미터 바인딩 방지)
    const limitValue = (node.limit as any)?.value;
    if (typeof limitValue === 'number') {
      this.append(`fetch first ${limitValue} rows only`);
    } else {
      // 값이 없거나 복잡한 경우 무시
      this.append('/* LIMIT not supported in Oracle 11g */');
    }
  }

  protected override visitOffset(node: OffsetNode): void {
    // OFFSET 값을 직접 숫자로 추출
    const offsetValue = (node.offset as any)?.value;
    if (typeof offsetValue === 'number') {
      this.append(`offset ${offsetValue} rows`);
    } else {
      this.append('/* OFFSET not supported in Oracle 11g */');
    }
  }

  protected override visitValue(node: ValueNode): void {
    const val = node.value;

    if (val === true) {
      this.append('1');
      return;
    }

    if (val === false) {
      this.append('0');
      return;
    }

    if (val === null || val === undefined) {
      this.append('null');
      return;
    }

    super.visitValue(node);
  }

  /**
   * Oracle에서 테이블 별칭 처리
   * Oracle은 테이블 별칭에 AS 키워드를 지원하지 않음
   */
  protected override visitAlias(node: AliasNode): void {
    this.visitNode(node.node);
    this.append(' ');  // AS 대신 공백만 사용
    this.visitNode(node.alias);
  }
}

// Oracle 데이터베이스 연결
class OracleConnection implements DatabaseConnection {
  private oracledb: any;
  private inTransaction = false;

  constructor(private connection: any, oracledb: any) {
    this.oracledb = oracledb;
  }

  setInTransaction(value: boolean): void {
    this.inTransaction = value;
  }

  getInternalConnection(): any {
    return this.connection;
  }

  /**
   * Oracle 11g: FETCH FIRST N ROWS ONLY를 ROWNUM으로 변환
   *
   * 변환 전: SELECT ... FROM ... WHERE ... ORDER BY ... fetch first 1 rows only
   * 변환 후: SELECT * FROM (SELECT ... FROM ... WHERE ... ORDER BY ...) WHERE ROWNUM <= 1
   */
  private convertLimitToRownum(sql: string): string {
    // FETCH FIRST N ROWS ONLY 패턴 매칭
    const fetchFirstMatch = sql.match(/\s+fetch\s+first\s+(\d+)\s+rows\s+only\s*$/i);
    if (!fetchFirstMatch) {
      return sql;
    }

    const limit = fetchFirstMatch[1];
    // FETCH FIRST 절 제거
    const baseSql = sql.replace(/\s+fetch\s+first\s+\d+\s+rows\s+only\s*$/i, '');

    // ROWNUM으로 래핑 (ORDER BY가 있어도 서브쿼리로 감싸서 정상 동작)
    return `SELECT * FROM (${baseSql}) WHERE ROWNUM <= ${limit}`;
  }

  /**
   * Oracle 11g: OFFSET과 FETCH FIRST를 ROWNUM으로 변환 (페이징)
   *
   * 변환 전: SELECT ... ORDER BY ... offset 10 rows fetch first 20 rows only
   * 변환 후: SELECT * FROM (SELECT a.*, ROWNUM rnum FROM (...) a WHERE ROWNUM <= 30) WHERE rnum > 10
   */
  private convertOffsetFetchToRownum(sql: string): string {
    // OFFSET N ROWS FETCH FIRST M ROWS ONLY 패턴
    const offsetFetchMatch = sql.match(/\s+offset\s+(\d+)\s+rows\s+fetch\s+first\s+(\d+)\s+rows\s+only\s*$/i);
    if (!offsetFetchMatch) {
      return sql;
    }

    const offset = parseInt(offsetFetchMatch[1], 10);
    const limit = parseInt(offsetFetchMatch[2], 10);
    const endRow = offset + limit;

    // OFFSET/FETCH 절 제거
    const baseSql = sql.replace(/\s+offset\s+\d+\s+rows\s+fetch\s+first\s+\d+\s+rows\s+only\s*$/i, '');

    // ROWNUM 기반 페이징
    return `SELECT * FROM (SELECT inner_t.*, ROWNUM rnum FROM (${baseSql}) inner_t WHERE ROWNUM <= ${endRow}) WHERE rnum > ${offset}`;
  }

  /**
   * Oracle 재귀 CTE에 컬럼 별칭 목록 추가
   * WITH cte AS (SELECT col1, col2 ...) → WITH cte(col1, col2) AS (SELECT col1, col2 ...)
   */
  private addColumnListToRecursiveCTE(sql: string): string {
    // WITH cte_name AS (select ... 패턴 찾기
    const withMatch = sql.match(/^(WITH\s+)(\w+)(\s+AS\s*\(\s*)(SELECT\s+)/i);
    if (!withMatch) return sql;

    const [fullMatch, withKeyword, cteName, asClause, selectKeyword] = withMatch;
    const afterSelect = sql.slice(fullMatch.length);

    // SELECT 절에서 FROM 전까지의 컬럼 목록 추출 (괄호 깊이 추적)
    const columns: string[] = [];
    let current = '';
    let depth = 0;
    let foundFrom = false;

    for (let i = 0; i < afterSelect.length; i++) {
      const char = afterSelect[i];
      const rest = afterSelect.slice(i).toLowerCase();

      if (char === '(') depth++;
      else if (char === ')') depth--;

      // 최상위 레벨에서 FROM 키워드를 만나면 종료
      if (depth === 0 && rest.match(/^from\s/i)) {
        if (current.trim()) columns.push(current.trim());
        foundFrom = true;
        break;
      }

      // 최상위 레벨에서 쉼표를 만나면 컬럼 구분
      if (depth === 0 && char === ',') {
        if (current.trim()) columns.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (!foundFrom || columns.length === 0) return sql;

    // 컬럼 이름/별칭 추출 (마지막 단어 또는 AS 다음 단어)
    const columnNames = columns.map(col => {
      // 서브쿼리인 경우 (괄호로 시작) → 별칭 추출
      const aliasMatch = col.match(/\)\s*(?:as\s+)?(\w+)\s*$/i) || col.match(/\s+(?:as\s+)?(\w+)\s*$/i);
      if (aliasMatch) return aliasMatch[1];
      // 단순 컬럼명
      const parts = col.trim().split(/\s+/);
      const lastPart = parts[parts.length - 1];
      // 테이블.컬럼 형태면 컬럼명만 추출
      return lastPart.includes('.') ? lastPart.split('.').pop() : lastPart;
    });

    // WITH cte(col1, col2, ...) AS (SELECT ... 형태로 재구성
    return `${withKeyword}${cteName}(${columnNames.join(', ')})${asClause}${selectKeyword}${afterSelect}`;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    let { sql, parameters } = compiledQuery;

    // Oracle: WITH RECURSIVE를 WITH로 변환 (Oracle은 RECURSIVE 키워드 불필요)
    sql = sql.replace(/\bwith\s+recursive\b/gi, 'WITH');

    // Oracle: 재귀 CTE에 컬럼 별칭 목록 추가
    sql = this.addColumnListToRecursiveCTE(sql);

    // Oracle 11g: 서브쿼리 내 FETCH FIRST를 ROWNUM으로 변환
    // WHERE 절이 있는 서브쿼리: WHERE ... fetch first N rows only) → WHERE ... AND ROWNUM <= N)
    sql = sql.replace(
      /(\bwhere\s+[\s\S]+?)\s+fetch\s+first\s+(\d+)\s+rows\s+only\s*\)/gi,
      '$1 AND ROWNUM <= $2)'
    );

    // Oracle 11g: OFFSET/FETCH 또는 FETCH FIRST를 ROWNUM으로 변환
    sql = this.convertOffsetFetchToRownum(sql);
    sql = this.convertLimitToRownum(sql);

    try {
      // Oracle 파라미터는 객체 형태로 변환 { 1: value1, 2: value2, ... }
      const bindParams: Record<string, any> = {};
      parameters.forEach((param, index) => {
        bindParams[(index + 1).toString()] = param;
      });

      // oracledb의 execute 호출
      // OUT_FORMAT_OBJECT = oracledb.OUT_FORMAT_OBJECT (결과를 객체로 반환)
      // autoCommit: 트랜잭션 중이면 false, 아니면 true
      // fetchAsString: CLOB 데이터를 문자열로 자동 변환
      const result = await this.connection.execute(sql, bindParams, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
        autoCommit: !this.inTransaction,
        fetchAsString: [this.oracledb.CLOB],
      });

      // RETURNING INTO 결과 처리
      let rows = result.rows || [];

      // outBinds가 있으면 (RETURNING INTO 사용 시)
      if (result.outBinds) {
        rows = [result.outBinds];
      }

      // Oracle은 컬럼명을 대문자로 반환하므로 소문자로 변환
      // (CamelCasePlugin이 snake_case → camelCase 변환 처리)
      rows = rows.map((row: any) => {
        const newRow: Record<string, any> = {};
        for (const key of Object.keys(row)) {
          newRow[key.toLowerCase()] = row[key];
        }
        return newRow;
      });

      // INSERT/UPDATE/DELETE의 경우 rowsAffected 반환
      const numAffectedRows =
        result.rowsAffected != null ? BigInt(result.rowsAffected) : undefined;

      return {
        rows: rows as R[],
        numAffectedRows,
      };
    } catch (err: any) {
      // 오류 발생 시 SQL과 파라미터 로깅
      console.error('[Oracle] Query failed:', sql);
      console.error('[Oracle] Parameters:', parameters);
      console.error('[Oracle] Error:', err.message);
      throw err;
    }
  }

  async *streamQuery<R>(
    _compiledQuery: CompiledQuery,
    _chunkSize?: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Streaming not implemented for Oracle');
  }
}

// Oracle 드라이버
class OracleDriver implements Driver {
  private pool: any = null;
  private oracledb: any = null;

  constructor(private config: OracleDialectConfig) {}

  async init(): Promise<void> {
    // 동적 import로 oracledb 로드 (설치되지 않았을 수 있음)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.oracledb = require('oracledb');

      // CLOB 데이터를 자동으로 문자열로 변환 (전역 설정)
      this.oracledb.fetchAsString = [this.oracledb.CLOB];
      // BLOB 데이터를 자동으로 Buffer로 변환 (전역 설정)
      this.oracledb.fetchAsBuffer = [this.oracledb.BLOB];
      console.log('[Oracle] fetchAsString/fetchAsBuffer configured for LOB types');

      // Oracle 11g는 Thick 모드가 필요 (Oracle Instant Client 필수)
      // Thin 모드는 Oracle 12.1+ 에서만 지원
      if (this.config.version === '11g' || this.config.instantClientPath) {
        try {
          // Thick 모드 초기화 (Oracle Instant Client 경로 지정)
          const clientOpts: any = {};
          if (this.config.instantClientPath) {
            clientOpts.libDir = this.config.instantClientPath;
          }
          this.oracledb.initOracleClient(clientOpts);
          console.log('[Oracle] Thick mode initialized');
        } catch (initErr: any) {
          // 이미 초기화된 경우 무시
          if (!initErr.message?.includes('already been initialized')) {
            console.error('[Oracle] Failed to initialize Thick mode:', initErr.message);
            console.error('[Oracle] Oracle 11g requires Oracle Instant Client.');
            console.error('[Oracle] Please install Oracle Instant Client and set ORACLE_INSTANT_CLIENT_PATH in .env');
            console.error('[Oracle] Download: https://www.oracle.com/database/technologies/instant-client/downloads.html');
            throw new Error(
              `Oracle 11g requires Thick mode with Oracle Instant Client. ` +
              `Install Instant Client and set ORACLE_INSTANT_CLIENT_PATH environment variable. ` +
              `Original error: ${initErr.message}`
            );
          }
        }
      }

      this.pool = await this.oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: this.config.connectString,
        poolMin: 2,
        poolMax: this.config.poolMax || 10,
        poolIncrement: 1,
      });
    } catch (err: any) {
      if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'oracledb package not installed. Run: pnpm add oracledb',
        );
      }
      // NJS-138: Thin mode doesn't support this Oracle version
      if (err.code === 'NJS-138') {
        throw new Error(
          `Oracle 11g is not supported in Thin mode. ` +
          `Please install Oracle Instant Client and set ORACLE_INSTANT_CLIENT_PATH in .env. ` +
          `Download: https://www.oracle.com/database/technologies/instant-client/downloads.html`
        );
      }
      throw err;
    }
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const connection = await this.pool.getConnection();
    return new OracleConnection(connection, this.oracledb);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    // Oracle은 암시적 트랜잭션 시작 (첫 DML에서 자동 시작)
    // autoCommit을 false로 설정하여 트랜잭션 모드 활성화
    (connection as OracleConnection).setInTransaction(true);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const oracleConn = connection as OracleConnection;
    await oracleConn.getInternalConnection().commit();
    oracleConn.setInTransaction(false);
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const oracleConn = connection as OracleConnection;
    await oracleConn.getInternalConnection().rollback();
    oracleConn.setInTransaction(false);
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    const oracleConn = connection as OracleConnection;
    await oracleConn.getInternalConnection().close();
  }

  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close(0);
    }
  }
}

// Oracle Introspector (스키마 정보 조회)
class OracleIntrospector implements DatabaseIntrospector {
  constructor(private db: Kysely<any>) {}

  async getSchemas(): Promise<any[]> {
    // Oracle의 스키마(사용자) 목록 조회
    const result: any = await (this.db as any)
      .selectFrom('all_users')
      .select('username')
      .execute();

    return result.map((row: any) => ({ name: row.username || row.USERNAME }));
  }

  async getTables(options?: { withInternalKyselyTables?: boolean }): Promise<any[]> {
    // Oracle의 테이블 목록 조회
    let query = (this.db as any)
      .selectFrom('user_tables')
      .select('table_name');

    if (!options?.withInternalKyselyTables) {
      // Kysely 마이그레이션 테이블 제외
      query = query.where('table_name', 'not like', 'KYSELY_%');
    }

    const result: any = await query.execute();
    return result.map((row: any) => ({
      name: row.table_name || row.TABLE_NAME,
      schema: undefined, // Oracle은 스키마가 사용자와 동일
      isView: false,
    }));
  }

  async getMetadata(): Promise<any> {
    return {
      tables: await this.getTables(),
    };
  }
}

export interface OracleDialectConfig {
  user: string;
  password: string;
  connectString: string; // host:port/servicename
  poolMax?: number;
  /**
   * Oracle 버전
   * - '11g': Oracle 11g (ROWNUM 기반 페이징, Thick 모드 필수)
   * - '12c': Oracle 12c+ (OFFSET/FETCH 기반 페이징, Thin 모드 가능)
   * 기본값: '11g' (더 넓은 호환성)
   */
  version?: '11g' | '12c';
  /**
   * Oracle Instant Client 경로 (Thick 모드용)
   * Oracle 11g 연결 시 필수
   * 예: 'C:\\oracle\\instantclient_19_8' (Windows)
   *     '/usr/lib/oracle/19.8/client64/lib' (Linux)
   */
  instantClientPath?: string;
}

/**
 * Oracle Dialect for Kysely
 *
 * 사용 예시:
 * ```typescript
 * const dialect = new OracleDialect({
 *   user: 'gwuser',
 *   password: 'password',
 *   connectString: '192.168.1.1:1521/ORCL',
 *   poolMax: 10,
 *   version: '11g', // 또는 '12c'
 * });
 * ```
 */
export class OracleDialect implements Dialect {
  constructor(private config: OracleDialectConfig) {}

  createAdapter(): DialectAdapter {
    return new OracleAdapter();
  }

  createDriver(): Driver {
    return new OracleDriver(this.config);
  }

  createQueryCompiler(): QueryCompiler {
    // Oracle 버전에 따른 컴파일러 선택
    if (this.config.version === '12c') {
      return new OracleQueryCompiler();
    }
    // 기본값: 11g 호환 컴파일러
    return new Oracle11gQueryCompiler();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new OracleIntrospector(db);
  }
}

/**
 * Oracle 연결 문자열 파싱
 * oracle://user:password@host:port/servicename
 *
 * 버전 지정 (선택):
 * oracle://user:password@host:port/servicename?version=11g
 * oracle://user:password@host:port/servicename?version=12c
 */
export function parseOracleConnectionString(connectionString: string): OracleDialectConfig {
  const url = new URL(connectionString.replace('oracle://', 'http://'));

  // 쿼리 파라미터에서 버전 확인
  const versionParam = url.searchParams.get('version');
  const version: '11g' | '12c' = versionParam === '12c' ? '12c' : '11g';

  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    connectString: `${url.hostname}:${url.port || 1521}${url.pathname}`,
    version,
  };
}
