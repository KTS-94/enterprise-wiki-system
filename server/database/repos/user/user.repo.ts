/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 그룹웨어 조직도 DB(sys_object_user) 연동 조회
 */
// apps/server/src/database/repos/user/user.repo.ts

import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { DB } from '@docmost/db/types/db';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertSettingtableUser,
  SysObjectUser,
  UserSetting,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../pagination/pagination-options';
import { executeWithPagination } from '@docmost/db/pagination/pagination';
import { ExpressionBuilder, sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { BaseRepo } from '../base.repo';

function keysToLowerCase<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(
  Object.entries(obj).map(([key, val]) => [key.toLowerCase(), val])
  ) as T;
}

@Injectable()
export class UserRepo extends BaseRepo {
  constructor(
    @InjectKysely() db: KyselyDB,
    environmentService: EnvironmentService,
  ) {
    super(db, environmentService);
  }

  // ─────────────────────────────
  // 내부 유틸: settings 정규화 / 병합
  // ─────────────────────────────
  private normalizeUserSettings<T extends { settings?: any } | null | undefined>(
    u: T,
  ): T {
    if (u && typeof (u as any).settings === 'string') {
      try {
        (u as any).settings = JSON.parse((u as any).settings);
      } catch {
        (u as any).settings = {};
      }
    }
    if (u && (u as any).settings == null) {
      (u as any).settings = {};
    }
    return u;
  }

  // gw 조직도 조회
  async getByUserCode(
  userCode: string,
  opts?: { trx?: KyselyTransaction },
  ): Promise<SysObjectUser | null> {
    const db = dbOrTx(this.db, opts?.trx);
    const dialect = String(this.getDialectType());

     const row = await db
    .selectFrom('covi_smart4j.sys_object_user as U')
      .leftJoin(
        'covi_smart4j.sys_object_user_basegroup as G1',
        (join) =>
          join
            .onRef('G1.usercode', '=', 'U.usercode')
            .on('G1.jobtype', '=', sql.lit('Origin')),
      )
      .select([
        'U.userid',
        'U.usercode',
        'U.logonid',
        'U.empno',
        'U.displayname',
        'U.nickname',
        'U.multidisplayname',
        'U.isuse',
        'U.photopath',
        'U.mailaddress',
        'U.externalmailaddress',
        'U.latest_login_date',
        'U.languagecode',
        'U.timezonecode',
        'U.registdate',
        'U.modifydate',

        // 조인 필드
        'G1.companycode',
        'G1.companyname',
        'G1.deptcode',
        'G1.multideptname as deptname',
        'G1.multijoblevelname as joblevel',
        'G1.multijobtitlename as jobtitle',
        'G1.multijobpositionname as jobposition',
      ] as any)
      .where('U.usercode', '=', userCode)
      .where('U.isuse', '=', 'Y')
      .executeTakeFirst();

    if (!row) return null;

    return keysToLowerCase(row) as SysObjectUser;
  }

  // gw 유저세팅 조회
  async getSettings(
  usercode: string,
  workspaceId: string,
  opts?: { trx?: KyselyTransaction },
  ): Promise<UserSetting | null> {
    const db = dbOrTx(this.db, opts?.trx);
    const dialect = String(this.getDialectType());

    const row = await db
    .selectFrom('wiki_user_settings')
    .selectAll()
    .where(sql.ref('usercode'), '=', usercode)
    .where(sql.ref('workspace_id'), '=', workspaceId)
    .executeTakeFirst();

    if (!row) return null;
    return row as UserSetting;
  }

  // gw 유저세팅 조회(세션 생성용) - workspaceId가 회사코드로 대체됨
  async getSettingsByCompanyCode(
  usercode: string,
  companycode: string,
  opts?: { trx?: KyselyTransaction },
): Promise<UserSetting | null> {
  const db = dbOrTx(this.db, opts?.trx);

  const row = await db
    .selectFrom('wiki_user_settings as us')
    .selectAll('us')
    .where('us.usercode', '=', usercode)
    .where('us.workspace_id', '=', companycode)
    .executeTakeFirst();

  if (!row) return null;
  return row as UserSetting;
}

  async insertUserSetting(
    insertableUser: InsertSettingtableUser,
    trx?: KyselyTransaction,
  ): Promise<UserSetting> {
    const db = dbOrTx(this.db, trx);
    const dialect = String(this.getDialectType());

    const user: InsertSettingtableUser = {
      usercode: insertableUser.usercode, // 반드시 있어야 함
      workspace_id: insertableUser.workspace_id,
      role: 'member',
      locale: 'ko-KR',
      page_edit_mode: 'edit',
      full_page_width: true,
      created_at: new Date(),
    };

    if (dialect === 'postgres') {
      return db
        .insertInto('wiki_user_settings')
        .values(user)
        .returningAll()
        .executeTakeFirst();
    }

    await db.insertInto('wiki_user_settings').values(user).execute();

    // 복합 키일 수 있으므로 workspace_id 포함해서 조회
    return this.getSettings(user.usercode, user.workspace_id);
  }

  async updateLastLogin(userId: string, workspaceId: string) {
    return await this.db
      .updateTable('wiki_user_settings')
      .set({ last_login_at: new Date() })
      .where('usercode', '=', userId)
      .where('workspace_id', '=', workspaceId)
      .execute();
  }

  async getUsersPaginated(workspaceId: string, pagination: PaginationOptions) {
    const dialect = String(this.getDialectType());

    let query = this.db
      .selectFrom('covi_smart4j.sys_object_user')
      .innerJoin(
        'wiki_user_settings',
        'wiki_user_settings.usercode',
        'covi_smart4j.sys_object_user.usercode',
      )
      .select((eb) => [
        eb.ref('covi_smart4j.sys_object_user.usercode').as('id'),
        eb.ref('covi_smart4j.sys_object_user.multidisplayname').as('name'),
        eb.ref('covi_smart4j.sys_object_user.mailaddress').as('email'),
        eb.ref('covi_smart4j.sys_object_user.photopath').as('avatarUrl'),
        eb.ref('wiki_user_settings.workspace_id').as('workspaceId'),
      ])
      .where('wiki_user_settings.workspace_id', '=', workspaceId)
      .where('covi_smart4j.sys_object_user.isuse', '=', 'Y')
      .orderBy('covi_smart4j.sys_object_user.usercode', 'asc');

    if (pagination.query) {
      const like = `%${pagination.query}%`;
      if (dialect === 'postgres') {
        query = query.where((eb) =>
          eb.or([
            eb(sql`f_unaccent(covi_smart4j.sys_object_user.multidisplayname)`, 'ilike', sql`f_unaccent(${like})`),
            eb(sql`f_unaccent(covi_smart4j.sys_object_user.mailaddress)`, 'ilike', sql`f_unaccent(${like})`),
          ]),
        );
      } else {
        const lowerLike = like.toLowerCase();
        query = query.where((eb) =>
          eb.or([
            eb(sql`LOWER(covi_smart4j.sys_object_user.multidisplayname)`, 'like', lowerLike),
            eb(sql`LOWER(covi_smart4j.sys_object_user.mailaddress)`, 'like', lowerLike),
          ]),
        );
      }
    }

    const page: any = await executeWithPagination(query, {
      page: pagination.page,
      perPage: pagination.limit,
    });

    const list =
      Array.isArray(page?.data)  ? page.data  :
      Array.isArray(page?.items) ? page.items :
      Array.isArray(page?.rows)  ? page.rows  : [];

    const normalized = list.map((u: any) => this.normalizeUserSettings(u));

    if (Array.isArray(page?.data))  page.data  = normalized;
    if (Array.isArray(page?.items)) page.items = normalized;
    if (Array.isArray(page?.rows))  page.rows  = normalized;

    return page;
  }


  // ─────────────────────────────
  // 그룹웨어 권한 체크 (isAdmin / isEasyAdmin)
  // ─────────────────────────────
  async isGwAdmin(userCode: string, companyCode: string): Promise<boolean> {
    const groupTable = this.t.sysGroup;
    const groupMemberTable = this.t.sysGroupMember;
    const dialect = this.getDialectType();
    const fromDual = dialect === 'oracle' ? sql`FROM DUAL` : sql``;

    const result = await sql<{ isAdmin: string }>`
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${sql.raw(groupTable)} gr
            INNER JOIN ${sql.raw(groupMemberTable)} gm
              ON gm.GroupCode = gr.GroupCode
            WHERE gr.CompanyCode = ${companyCode}
              AND gr.GroupType = 'Authority'
              AND gr.IsUse = 'Y'
              AND gm.UserCode = ${userCode}
          )
          THEN 'Y'
          ELSE 'N'
        END AS isAdmin
      ${fromDual}
    `.execute(this.db);

    const row = result.rows?.[0] as Record<string, any> | undefined;
    return row?.['isadmin'] === 'Y' || row?.['isAdmin'] === 'Y' || row?.['ISADMIN'] === 'Y';
  }

  async isGwEasyAdmin(userCode: string, companyCode: string): Promise<boolean> {
    const groupTable = this.t.sysGroup;
    const groupMemberTable = this.t.sysGroupMember;
    const groupMembergroupTable = this.t.sysGroupMembergroup;
    const dialect = this.getDialectType();
    const fromDual = dialect === 'oracle' ? sql`FROM DUAL` : sql``;

    const result = await sql<{ isEasyAdmin: string }>`
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${sql.raw(groupTable)} gr
            JOIN ${sql.raw(groupMemberTable)} gm
              ON gm.GroupCode = gr.GroupCode
            WHERE gr.CompanyCode = ${companyCode}
              AND gr.GroupCode LIKE '%_EasyAdmin'
              AND gm.UserCode = ${userCode}
          )
          OR EXISTS (
            SELECT 1
            FROM ${sql.raw(groupTable)} gr
            JOIN ${sql.raw(groupMembergroupTable)} gmg
              ON gmg.GroupCode = gr.GroupCode
            JOIN ${sql.raw(groupMemberTable)} ugm
              ON ugm.GroupCode = gmg.MemberGroupCode
            WHERE gr.CompanyCode = ${companyCode}
              AND gr.GroupCode LIKE '%_EasyAdmin'
              AND ugm.UserCode = ${userCode}
          )
          THEN 'Y'
          ELSE 'N'
        END AS isEasyAdmin
      ${fromDual}
    `.execute(this.db);

    const row = result.rows?.[0] as Record<string, any> | undefined;
    return row?.['iseasyadmin'] === 'Y' || row?.['isEasyAdmin'] === 'Y' || row?.['ISEASYADMIN'] === 'Y';
  }

  async isGwAdminOrEasyAdmin(userCode: string, companyCode: string): Promise<boolean> {
    const [isAdmin, isEasyAdmin] = await Promise.all([
      this.isGwAdmin(userCode, companyCode),
      this.isGwEasyAdmin(userCode, companyCode),
    ]);
    return isAdmin || isEasyAdmin;
  }

  // ─────────────────────────────
  // preferences 전용 업데이트
  // ─────────────────────────────
  async updatePreference(
    usercode: string,
    workspaceId: string,
    prefKey: 'page_edit_mode' | 'full_page_width',
    prefValue: string | boolean,
  ): Promise<UserSetting> {
    await this.db
      .updateTable('wiki_user_settings')
      .set({
        [prefKey]: prefValue,
        updated_at: new Date(),
      })
      .where('usercode', '=', usercode)
      .execute();

    return this.getSettings(usercode, workspaceId);
  }
}
