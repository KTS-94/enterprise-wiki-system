/**
 * 공통 서브쿼리 빌더
 *
 * Raw SQL에서 사용하는 테이블명, JSON 빌드, 검색 조건 등을
 * DB 타입에 맞게 자동으로 생성합니다.
 */

import { sql, RawBuilder } from 'kysely';
import { EnvironmentService } from '../../integrations/environment/environment.service';

export type DatabaseDialect = 'mysql' | 'postgres' | 'oracle' | 'unknown';

/**
 * 테이블명 빌더
 * 스키마와 프리픽스를 자동으로 적용합니다.
 */
export class TableNames {
  constructor(private env: EnvironmentService) {}

  /** Wiki 테이블명 (예: covi_wiki.wiki_pages) */
  wiki(tableName: string): string {
    return this.env.getWikiTableName(tableName);
  }

  /** 그룹웨어 테이블명 (예: covi_smart4j.sys_object_user) */
  gw(tableName: string): string {
    return this.env.getGwTableName(tableName);
  }

  // 자주 사용하는 테이블 shortcut (wiki_ 프리픽스 포함)
  get pages(): string { return this.wiki('wiki_pages'); }
  get spaces(): string { return this.wiki('wiki_spaces'); }
  get spaceMembers(): string { return this.wiki('wiki_space_members'); }
  get pageHistory(): string { return this.wiki('wiki_page_history'); }
  get pageShare(): string { return this.wiki('wiki_page_share'); }
  get attachments(): string { return this.wiki('wiki_attachments'); }
  get templates(): string { return this.wiki('wiki_templates'); }
  get userSettings(): string { return this.wiki('wiki_user_settings'); }

  // 그룹웨어 테이블
  get sysUser(): string { return this.gw('sys_object_user'); }
  get sysUserBasegroup(): string { return this.gw('sys_object_user_basegroup'); }
  get sysGroup(): string { return this.gw('sys_object_group'); }
  get sysGroupMember(): string { return this.gw('sys_object_group_member'); }
  get sysGroupMembergroup(): string { return this.gw('sys_object_group_membergroup'); }
}

/**
 * JSON 빌드 헬퍼
 * DB별로 다른 JSON 생성 문법을 통일합니다.
 */
export class JsonBuilder {
  constructor(private dialect: DatabaseDialect) {}

  /**
   * JSON 객체 생성
   * @param fields { key: 'column_name' } 형태
   * @param tableAlias 테이블 별칭 (예: 'u')
   */
  object(fields: Record<string, string>, tableAlias?: string): string {
    const prefix = tableAlias ? `${tableAlias}.` : '';

    switch (this.dialect) {
      case 'postgres':
        const pgPairs = Object.entries(fields)
          .map(([key, col]) => `'${key}', ${prefix}${col}`)
          .join(', ');
        return `JSON_BUILD_OBJECT(${pgPairs})`;

      case 'mysql':
        const myPairs = Object.entries(fields)
          .map(([key, col]) => `'${key}', ${prefix}${col}`)
          .join(', ');
        return `JSON_OBJECT(${myPairs})`;

      case 'oracle':
        // Oracle 11g: JSON 함수 없음 → 문자열 합성
        const orPairs = Object.entries(fields)
          .map(([key, col]) => `'"${key}":"' || NVL(${prefix}${col}, '') || '"'`)
          .join(` || ',' || `);
        return `'{' || ${orPairs} || '}'`;

      default:
        return 'NULL';
    }
  }

  /**
   * 사용자 정보 JSON 객체 (자주 사용)
   * { id, name, avatarUrl }
   */
  userObject(tableAlias: string = 'u'): string {
    return this.object({
      id: 'usercode',
      name: 'multidisplayname',
      avatarUrl: 'photopath',
    }, tableAlias);
  }

  /**
   * 사용자 정보 + 조직 정보 JSON 객체
   * { id, name, avatarUrl, deptName, jobLevel }
   */
  userWithOrgObject(userAlias: string = 'u', bgAlias: string = 'ub'): string {
    const fields: Record<string, string> = {
      id: `${userAlias}.usercode`,
      name: `${userAlias}.multidisplayname`,
      avatarUrl: `${userAlias}.photopath`,
      deptName: `${bgAlias}.multideptname`,
      jobLevel: `${bgAlias}.multijoblevelname`,
    };

    switch (this.dialect) {
      case 'postgres': {
        const pairs = Object.entries(fields)
          .map(([key, col]) => `'${key}', ${col}`)
          .join(', ');
        return `JSON_BUILD_OBJECT(${pairs})`;
      }
      case 'mysql': {
        const pairs = Object.entries(fields)
          .map(([key, col]) => `'${key}', ${col}`)
          .join(', ');
        return `JSON_OBJECT(${pairs})`;
      }
      case 'oracle': {
        const pairs = Object.entries(fields)
          .map(([key, col]) => `'"${key}":"' || NVL(${col}, '') || '"'`)
          .join(` || ',' || `);
        return `'{' || ${pairs} || '}'`;
      }
      default:
        return 'NULL';
    }
  }

  /**
   * 스페이스 정보 JSON 객체
   * { id, name, slug }
   */
  spaceObject(tableAlias: string = 's'): string {
    return this.object({
      id: 'id',
      name: 'name',
      slug: 'slug',
    }, tableAlias);
  }
}

/**
 * 서브쿼리 빌더
 * 공통적으로 사용되는 서브쿼리 패턴을 제공합니다.
 */
export class SubqueryBuilder {
  public tables: TableNames;
  public json: JsonBuilder;

  constructor(
    private env: EnvironmentService,
    private dialect: DatabaseDialect,
  ) {
    this.tables = new TableNames(env);
    this.json = new JsonBuilder(dialect);
  }

  /**
   * 사용자 정보 서브쿼리
   * pages.creator_id → { id, name, avatarUrl }
   */
  userSubquery(
    refColumn: string,
    parentTable: string = 'pages',
    alias: string = 'u',
  ): RawBuilder<any> {
    const userTable = this.tables.sysUser;
    const jsonObj = this.json.userObject(alias);
    const limit = this.dialect === 'oracle' ? 'AND ROWNUM = 1' : 'LIMIT 1';

    return sql`(
      SELECT ${sql.raw(jsonObj)}
      FROM ${sql.raw(userTable)} ${sql.raw(alias)}
      WHERE ${sql.raw(alias)}.usercode = ${sql.raw(parentTable)}.${sql.raw(refColumn)}
      ${sql.raw(limit)}
    )`;
  }

  /**
   * 사용자 정보 + 조직 정보 서브쿼리
   * pages.creator_id → { id, name, avatarUrl, deptName, jobLevel }
   */
  userWithOrgSubquery(
    refColumn: string,
    parentTable: string = 'pages',
    userAlias: string = 'u',
    bgAlias: string = 'ub',
  ): RawBuilder<any> {
    const userTable = this.tables.sysUser;
    const bgTable = this.tables.sysUserBasegroup;
    const jsonObj = this.json.userWithOrgObject(userAlias, bgAlias);
    const limit = this.dialect === 'oracle' ? 'AND ROWNUM = 1' : 'LIMIT 1';

    return sql`(
      SELECT ${sql.raw(jsonObj)}
      FROM ${sql.raw(userTable)} ${sql.raw(userAlias)}
      LEFT JOIN ${sql.raw(bgTable)} ${sql.raw(bgAlias)}
        ON ${sql.raw(bgAlias)}.usercode = ${sql.raw(userAlias)}.usercode
        AND ${sql.raw(bgAlias)}.jobtype = 'Origin'
      WHERE ${sql.raw(userAlias)}.usercode = ${sql.raw(parentTable)}.${sql.raw(refColumn)}
      ${sql.raw(limit)}
    )`;
  }

  /**
   * 스페이스 정보 서브쿼리
   * pages.space_id → { id, name, slug }
   */
  spaceSubquery(
    refColumn: string = 'space_id',
    parentTable: string = 'pages',
    alias: string = 's',
  ): RawBuilder<any> {
    const spaceTable = this.tables.spaces;
    const jsonObj = this.json.spaceObject(alias);
    const limit = this.dialect === 'oracle' ? 'AND ROWNUM = 1' : 'LIMIT 1';

    return sql`(
      SELECT ${sql.raw(jsonObj)}
      FROM ${sql.raw(spaceTable)} ${sql.raw(alias)}
      WHERE ${sql.raw(alias)}.id = ${sql.raw(parentTable)}.${sql.raw(refColumn)}
      ${sql.raw(limit)}
    )`;
  }

  /**
   * 기여자 목록 서브쿼리 (JSON Array)
   * pages.contributor_ids → [{ id, name, avatarUrl }, ...]
   */
  contributorsSubquery(parentTable: string = 'pages'): RawBuilder<any> {
    const userTable = this.tables.sysUser;

    if (this.dialect === 'mysql') {
      return sql`(
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', u.usercode,
            'name', u.multidisplayname,
            'avatarUrl', u.photopath
          )
        )
        FROM ${sql.raw(userTable)} u
        WHERE JSON_CONTAINS(${sql.raw(parentTable)}.contributor_ids, JSON_QUOTE(u.usercode), '$')
      )`;
    }

    if (this.dialect === 'oracle') {
      return sql`(
        SELECT
          '[' ||
          NVL(
            LISTAGG(
              '{"id":"' || u.usercode || '","name":"' ||
              REPLACE(NVL(u.multidisplayname, ''), '"', '""') ||
              '","avatarUrl":"' || NVL(u.photopath, '') || '"}', ','
            ) WITHIN GROUP (ORDER BY u.usercode),
            ''
          )
          || ']'
        FROM ${sql.raw(userTable)} u
        WHERE REGEXP_LIKE(
          ${sql.raw(parentTable)}.contributor_ids,
          '(^|\\[|,)[[:space:]]*"' || u.usercode || '"[[:space:]]*(,|\\])'
        )
      )`;
    }

    // PostgreSQL: varchar에 JSON 문자열 저장 (MariaDB/Oracle과 동일)
    // contributor_ids를 jsonb로 캐스팅하여 배열 요소와 비교
    // NULLIF로 빈 문자열을 NULL로 변환, COALESCE로 NULL을 '[]'로 대체
    return sql`(
      SELECT COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', u.usercode,
            'name', u.multidisplayname,
            'avatarUrl', u.photopath
          )
        ), '[]'::json
      )
      FROM ${sql.raw(userTable)} u
      WHERE COALESCE(NULLIF(${sql.raw(parentTable)}.contributor_ids, ''), '[]')::jsonb ? u.usercode
    )`;
  }

  /**
   * 스페이스 멤버 카운트 서브쿼리
   */
  memberCountSubquery(spaceIdRef: string = 'id'): RawBuilder<number> {
    const spaceMembersTable = this.tables.spaceMembers;
    const userBasegroupTable = this.tables.sysUserBasegroup;

    if (this.dialect === 'oracle') {
      // Oracle: snake_case (Oracle은 따옴표 없으면 대문자로 인식)
      return sql<number>`(
        SELECT COUNT(DISTINCT member_user_id)
        FROM (
          SELECT sm.user_id AS member_user_id
          FROM ${sql.raw(spaceMembersTable)} sm
          WHERE sm.space_id = ${sql.ref(spaceIdRef)}
            AND sm.user_id IS NOT NULL
          UNION
          SELECT ub.usercode AS member_user_id
          FROM ${sql.raw(spaceMembersTable)} sm
          JOIN ${sql.raw(userBasegroupTable)} ub
            ON sm.group_id = ub.deptcode
            AND ub.jobtype IN ('Origin', 'AddJob')
          WHERE sm.space_id = ${sql.ref(spaceIdRef)}
            AND sm.group_id IS NOT NULL
        ) combined
      )`;
    }

    // MySQL/MariaDB, PostgreSQL: snake_case
    return sql<number>`(
      SELECT COUNT(DISTINCT member_user_id)
      FROM (
        SELECT sm.user_id AS member_user_id
        FROM ${sql.raw(spaceMembersTable)} sm
        WHERE sm.space_id = ${sql.ref(spaceIdRef)}
          AND sm.user_id IS NOT NULL
        UNION
        SELECT ub.usercode AS member_user_id
        FROM ${sql.raw(spaceMembersTable)} sm
        JOIN ${sql.raw(userBasegroupTable)} ub
          ON sm.group_id = ub.deptcode
          AND ub.jobtype IN ('Origin', 'AddJob')
        WHERE sm.space_id = ${sql.ref(spaceIdRef)}
          AND sm.group_id IS NOT NULL
      ) AS combined
    )`;
  }

  /**
   * 검색 조건 (LIKE)
   */
  searchCondition(column: string, searchTerm: string): RawBuilder<boolean> {
    const like = `%${searchTerm.toLowerCase()}%`;

    if (this.dialect === 'postgres') {
      return sql`f_unaccent(${sql.raw(column)}) ilike f_unaccent(${like})`;
    }

    // MySQL / MariaDB / Oracle
    return sql`LOWER(${sql.raw(column)}) LIKE ${like}`;
  }
}

/**
 * SubqueryBuilder 팩토리 함수
 */
export function createSubqueryBuilder(
  env: EnvironmentService,
  dbUrl: string,
): SubqueryBuilder {
  let dialect: DatabaseDialect = 'unknown';

  if (dbUrl.startsWith('mysql') || dbUrl.startsWith('mariadb')) {
    dialect = 'mysql';
  } else if (dbUrl.startsWith('postgres')) {
    dialect = 'postgres';
  } else if (dbUrl.startsWith('oracle')) {
    dialect = 'oracle';
  }

  return new SubqueryBuilder(env, dialect);
}
