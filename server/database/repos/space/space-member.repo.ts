/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 그룹웨어 연동 배치 멤버 관리
 */
// apps/server/src/database/repos/space/space-member.repo.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import { sql } from 'kysely';
import {
  InsertableSpaceMember,
  SpaceMember,
  UpdatableSpaceMember,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../pagination/pagination-options';
import { MemberInfo, UserSpaceRole } from './types';
import { executeWithPagination } from '@docmost/db/pagination/pagination';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { BaseRepo } from '../base.repo';

@Injectable()
export class SpaceMemberRepo extends BaseRepo {
  constructor(
    @InjectKysely() db: KyselyDB,
    environmentService: EnvironmentService,
    private readonly spaceRepo: SpaceRepo,
  ) {
    super(db, environmentService);
  }

  async insertSpaceMember(
    // Service에서 배열로도 호출되므로 배열 허용
    insertableSpaceMember: InsertableSpaceMember | InsertableSpaceMember[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db.insertInto('wiki_space_members').values(insertableSpaceMember).execute();
  }

  async updateSpaceMember(
    updatableSpaceMember: UpdatableSpaceMember,
    spaceMemberId: string,
    spaceId: string,
  ): Promise<void> {
    await this.db
      .updateTable('wiki_space_members')
      .set(updatableSpaceMember)
      .where('id', '=', spaceMemberId)
      .where('space_id', '=', spaceId)
      .execute();
  }

  async getSpaceMemberByTypeId(
    spaceId: string,
    opts: { userId?: string; groupId?: string },
    trx?: KyselyTransaction,
  ): Promise<SpaceMember> {
    const db = dbOrTx(this.db, trx);

    let query = db
      .selectFrom('wiki_space_members')
      .selectAll()
      .where('space_id', '=', spaceId);

    if (opts.userId) {
      query = query.where('user_id', '=', opts.userId);
    } else if (opts.groupId) {
      query = query.where('group_id', '=', opts.groupId);
    } else {
      throw new BadRequestException('Please provide a userId or groupId');
    }

    return query.executeTakeFirst();
  }

  async removeSpaceMemberById(
    memberId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .deleteFrom('wiki_space_members')
      .where('id', '=', memberId)
      .where('space_id', '=', spaceId)
      .execute();
  }

  async roleCountBySpaceId(role: string, spaceId: string): Promise<number> {
    // 컬럼명이 ROLE이라도 각 DB에서 이 where절만 만족하면 전체 행 수를 세면 되므로 countAll()이 안전
    const row = await this.db
      .selectFrom('wiki_space_members')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('role', '=', role)
      .where('space_id', '=', spaceId)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  async getSpaceMembersPaginated(
    spaceId: string,
    pagination: PaginationOptions,
  ) {
    let query = this.db
      .selectFrom('wiki_space_members')
      .leftJoin('covi_smart4j.sys_object_user', 'covi_smart4j.sys_object_user.usercode', 'wiki_space_members.user_id')
      .select([
        'covi_smart4j.sys_object_user.usercode as userId',
        'covi_smart4j.sys_object_user.multidisplayname as userName',
        'covi_smart4j.sys_object_user.photopath as userAvatarUrl',
        'covi_smart4j.sys_object_user.mailaddress as userEmail',
        'wiki_space_members.role',
        'wiki_space_members.created_at as createdAt',
      ])
      .where('space_id', '=', spaceId)
      .orderBy('wiki_space_members.created_at', 'asc');

    if (pagination.query) {
      const qLike = `%${pagination.query}%`;
      if (this.getDialectType() === 'postgres') {
        // Postgres: ilike + unaccent
        query = query.where((eb) =>
          eb.or([
            eb(sql`f_unaccent(covi_smart4j.sys_object_user.multidisplayname)`, 'ilike', sql`f_unaccent(${qLike})`),
            eb(sql`covi_smart4j.sys_object_user.mailaddress`, 'ilike', sql`f_unaccent(${qLike})`),
          ]),
        );
      } else {
        // MySQL / MariaDB / Oracle: LOWER + LIKE
        const lowerLike = `%${pagination.query.toLowerCase()}%`;
        query = query.where((eb) =>
          eb.or([
            eb(sql`LOWER(covi_smart4j.sys_object_user.multidisplayname)`, 'like', lowerLike),
            eb(sql`LOWER(covi_smart4j.sys_object_user.mailaddress)`, 'like', lowerLike),
          ]),
        );
      }
    }

    const result = await executeWithPagination(query, {
      page: pagination.page,
      perPage: pagination.limit,
    });

    // shape 맞추기
    let memberInfo: MemberInfo;
    const members = result.items.map((m) => {
      if (m.userId) {
        memberInfo = {
          id: m.userId,
          name: m.userName,
          email: m.userEmail,
          avatarUrl: m.userAvatarUrl,
          type: 'user',
        };
      } 
      return { ...memberInfo, role: m.role, createdAt: m.createdAt };
    });

    result.items = members as any;
    return result;
  }

  async getUserSpaceRoles(
    userId: string,
    spaceId: string,
  ): Promise<UserSpaceRole[]> {
    const roles = await this.db
      .selectFrom('wiki_space_members')
      .select(['user_id as userId', 'role'])
      .where('user_id', '=', userId)
      .where('space_id', '=', spaceId)
      .unionAll(
        this.db
          .selectFrom('wiki_space_members')
          .select((eb) => [
            eb.val(userId).as('userId'), // 역할은 userId로 고정
            'wiki_space_members.role',
          ])
          .where('wiki_space_members.space_id', '=', spaceId)
          .where('wiki_space_members.group_id', 'in',
            this.db
              .selectFrom('covi_smart4j.sys_object_user_basegroup')
              .select('deptcode')
              .where('usercode', '=', userId)
              .where('jobtype', 'in', ['Origin', 'AddJob'])
          )
      )
      .execute();

    if (!roles || roles.length === 0) return undefined;
    return roles;
  }

  // 사용자가 스페이스 멤버가 아니더라도,
  // page_share로 공유된 페이지가 존재한다면,
  // 그 스페이스의 정보(/space/info)에 접근할 수 있어야 한다.
  async getPageShareRoleInSpace(
  usercode: string,
  spaceId: string
  ): Promise<'admin' | 'writer' | 'reader' | null> {
    const deptResults = await this.db
      .selectFrom('covi_smart4j.sys_object_user_basegroup')
      .select('deptcode')
      .where('usercode', '=', usercode)
      .where('jobtype', 'in', ['Origin', 'AddJob'])
      .execute();

    const deptcodes = deptResults.map((row) => row.deptcode);

    const shares = await this.db
      .selectFrom('wiki_page_share')
      .innerJoin('wiki_pages', 'wiki_page_share.page_id', 'wiki_pages.id')
      .select(['wiki_page_share.role'])
      .where('wiki_pages.space_id', '=', spaceId)
      .where('wiki_page_share.deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('wiki_page_share.to_usercode', '=', usercode),
          ...(deptcodes.length > 0
            ? [eb('wiki_page_share.to_groupcode', 'in', deptcodes)]
            : []),
        ])
      )
      .where((eb) =>
        eb.or([
          eb('wiki_page_share.expire_at', 'is', null),
          eb('wiki_page_share.expire_at', '>', sql<Date>`current_timestamp`),
        ])
      )
      .execute();

    if (!shares.length) return null;

    const priority = { admin: 3, writer: 2, reader: 1 };
    const top = shares.reduce((max, curr) =>
      (priority[curr.role] ?? 0) > (priority[max.role] ?? 0) ? curr : max
    );

    return top.role;
  }

  async getPageShareRole(
  usercode: string,
  pageId: string
  ): Promise<'admin' | 'writer' | 'reader' | null> {
    // 1. 부서코드 조회
    const deptResults = await this.db
      .selectFrom('covi_smart4j.sys_object_user_basegroup')
      .select('deptcode')
      .where('usercode', '=', usercode)
      .where('jobtype', 'in', ['Origin', 'AddJob'])
      .execute();

    const deptcodes = deptResults.map((row) => row.deptcode);

    // 2. page_share에서 toUsercode 또는 toGroupcode에 해당하는 공유 모두 조회
    const shares = await this.db
      .selectFrom('wiki_page_share')
      .select(['wiki_page_share.role', 'wiki_page_share.to_usercode', 'wiki_page_share.to_groupcode', 'wiki_page_share.created_at'])
      .where('wiki_page_share.page_id', '=', pageId)
      .where('wiki_page_share.deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('wiki_page_share.to_usercode', '=', usercode),
          ...(deptcodes.length > 0
            ? [eb('wiki_page_share.to_groupcode', 'in', deptcodes)]
            : []),
        ])
      )
      .where((eb) =>
        eb.or([
          eb('wiki_page_share.expire_at', 'is', null),
          eb('wiki_page_share.expire_at', '>', sql<Date>`current_timestamp`),
        ])
      )
      .execute();

    if (!shares || shares.length === 0) {
      return null;
    }

    // 3. 가장 높은 권한을 가진 공유 찾기
    const rolePriority = {
      admin: 3,
      writer: 2,
      reader: 1,
    } as const;

    const top = shares.reduce((highest, current) => {
      const currentPriority = rolePriority[current.role as keyof typeof rolePriority] ?? 0;
      const highestPriority = rolePriority[highest.role as keyof typeof rolePriority] ?? 0;
      return currentPriority > highestPriority ? current : highest;
    });

    return top.role as 'admin' | 'writer' | 'reader';
  }

  async getUserSpaceIds(userId: string): Promise<string[]> {
  const membership = await this.db
    // 1. 직접 멤버
    .selectFrom('wiki_space_members')
    .innerJoin('wiki_spaces', 'wiki_spaces.id', 'wiki_space_members.space_id')
    .select(['wiki_spaces.id'])
    .where('wiki_space_members.user_id', '=', userId)

     // 2. 부서 기반 멤버십
    .union(
      this.db
        .selectFrom('wiki_space_members')
        .innerJoin('wiki_spaces', 'wiki_spaces.id', 'wiki_space_members.space_id')
        .select(['wiki_spaces.id'])
        .where('wiki_space_members.group_id', 'in',
          this.db
            .selectFrom('covi_smart4j.sys_object_user_basegroup')
            .select('deptcode')
            .where('usercode', '=', userId)
            .where('jobtype', 'in', ['Origin', 'AddJob'])
        )
    )

    // 3. 공개 공간
    .union(
      this.db
        .selectFrom('wiki_spaces')
        .select(['wiki_spaces.id'])
        .where('wiki_spaces.visibility', '=', 'open')
    )

    .execute();

  return membership.map((s) => s.id);
}

  async getUserSpaces(userId: string, pagination: PaginationOptions) {
    const userSpaceIds = await this.getUserSpaceIds(userId);

    let query = this.db
      .selectFrom('wiki_spaces')
      .selectAll('wiki_spaces')
      .select((eb) => [this.spaceRepo.withMemberCount(eb)])
      .where('id', 'in', userSpaceIds)
      .orderBy('created_at', 'asc');

    if (pagination.query) {
      const qLike = `%${pagination.query}%`;
      if (this.getDialectType() === 'postgres') {
        query = query.where((eb) =>
          eb.or([
            eb(sql`f_unaccent(name)`, 'ilike', sql`f_unaccent(${qLike})`),
            eb(sql`f_unaccent(description)`, 'ilike', sql`f_unaccent(${qLike})`),
          ]),
        );
      } else {
        const lowerLike = `%${pagination.query.toLowerCase()}%`;
        query = query.where((eb) =>
          eb.or([
            eb(sql`LOWER(name)`, 'like', lowerLike),
            eb(sql`LOWER(description)`, 'like', lowerLike),
          ]),
        );
      }
    }

    const hasEmptyIds = userSpaceIds.length === 0;

    return executeWithPagination(query, {
      page: pagination.page,
      perPage: pagination.limit,
      hasEmptyIds,
    });
  }
}
