/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 멀티 DB JSON 파싱/정규화, DEFAULT_DOC 처리
 */
// apps/server/src/database/repos/page/page.repo.ts

import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertablePage,
  Page,
  UpdatablePage,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithPagination } from '@docmost/db/pagination/pagination';
import { validate as isValidUUID } from 'uuid';
import { ExpressionBuilder, sql } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { BaseRepo } from '../base.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

/** ---------- 기본 문서(JSON) & 유틸 ---------- */

// 최소 안전 문서 (Tiptap/PM)
const DEFAULT_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }],
} as const;

// 문자열이면 JSON.parse, 실패/빈값이면 null
function parseMaybeJson(v: unknown): any | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

// content 전용: {}/null/빈문자열 등 비정상 값을 DEFAULT_DOC 으로 보정
function sanitizeContentIn(raw: unknown) {
  const parsed = parseMaybeJson(raw);
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    return DEFAULT_DOC;
  }
  return parsed;
}

// 일반 JSON 필드: null 허용, 문자열이면 파싱
function normalizeJsonIn(raw: unknown) {
  const parsed = parseMaybeJson(raw);
  return parsed ?? null;
}

// 비-Postgres 반환값 파싱(문자열 JSON → 객체) + 기본값 보정
function jsonOut<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return (raw as T) ?? fallback;
}

// 선택적 필드 파싱 헬퍼
function parseIfJson<T>(maybe: any, fallback: T): T {
  if (maybe == null) return fallback;
  if (typeof maybe === 'string') {
    try {
      return JSON.parse(maybe);
    } catch {
      return fallback;
    }
  }
  return (maybe as T) ?? fallback;
}

@Injectable()
export class PageRepo extends BaseRepo {
  constructor(
    @InjectKysely() db: KyselyDB,
    environmentService: EnvironmentService,
    private spaceMemberRepo: SpaceMemberRepo,
  ) {
    super(db, environmentService);
  }

  private readonly baseFields = [
    'id',
    'slug_id',
    'title',
    'icon',
    'cover_photo',
    'position',
    'parent_page_id',
    'creator_id',
    'last_updated_by_id',
    'space_id',
    'workspace_id',
    'publish_status',
    'created_at',
    'updated_at',
    'deleted_at',
    'contributor_ids',
    'use_page_password',
  ] as const;

  withHasChildren(eb: ExpressionBuilder<DB, 'wiki_pages'>) {
    return eb
      .selectFrom('wiki_pages as child')
      .select((eb) =>
        eb
          .case()
          .when(eb.fn.countAll(), '>', 0)
          .then(true)
          .else(false)
          .end()
          .as('count'),
      )
      .whereRef('child.parent_page_id', '=', 'wiki_pages.id')
      .where('child.deleted_at', 'is', null)
      .limit(1)
      .as('hasChildren');
  }

  async findById(
    pageId: string,
    opts?: {
      includeContent?: boolean;
      includeYdoc?: boolean;
      includeSpace?: boolean;
      includeCreator?: boolean;
      includeLastUpdatedBy?: boolean;
      includeContributors?: boolean;
      includeHasChildren?: boolean;
      includeTextContent?: boolean;
      withLock?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<Page> {
    const db = dbOrTx(this.db, opts?.trx);
    const dialect = this.getDialectType();

    let query = db
      .selectFrom('wiki_pages')
      .select(this.baseFields)
      .$if(!!opts?.includeContent, (qb) => qb.select('content'))
      .$if(!!opts?.includeYdoc, (qb) => qb.select('ydoc'))
      .$if(!!opts?.includeTextContent, (qb) => qb.select('text_content'))
      .$if(!!opts?.includeHasChildren, (qb) =>
        qb.select((eb) => this.withHasChildren(eb)),
      );

    if (opts?.includeCreator) {
      query = query.select((eb) => this.withCreator(eb));
    }
    if (opts?.includeLastUpdatedBy) {
      query = query.select((eb) => this.withLastUpdatedBy(eb));
    }
    if (opts?.includeContributors) {
      query = query.select((eb) => this.withContributors(eb));
    }
    if (opts?.includeSpace) {
      query = query.select((eb) => this.withSpace(eb));
    }
    if (opts?.withLock && opts?.trx) {
      query = query.forUpdate();
    }

    if (isValidUUID(pageId)) {
      query = query.where('id', '=', pageId);
    } else {
      query = query.where('slug_id', '=', pageId);
    }

    const row: any = await query.executeTakeFirst();
    if (!row) return row;

    // 반환 시 보정: Postgres도 content가 이상하면 기본값으로
    if ('content' in row) {
      if (dialect === 'postgres') {
        row.content =
          !row.content || typeof row.content !== 'object' || !row.content.type
            ? DEFAULT_DOC
            : row.content;
      } else {
        row.content = jsonOut(row.content, DEFAULT_DOC);
      }
    }

    if (dialect !== 'postgres') {
      if ('contributor_ids' in row)
        row.contributor_ids = jsonOut(row.contributor_ids, []);
      if ('space' in row) row.space = parseIfJson(row.space, null);
      if ('creator' in row) row.creator = parseIfJson(row.creator, null);
      if ('lastUpdatedBy' in row)
        row.lastUpdatedBy = parseIfJson(row.lastUpdatedBy, null);
      if ('deletedBy' in row) row.deletedBy = parseIfJson(row.deletedBy, null);
      if ('contributors' in row)
        row.contributors = parseIfJson(row.contributors, []);
    }

    return row as Page;
  }

  async updatePages(
    updatePageData: UpdatablePage,
    pageIds: string[],
    trx?: KyselyTransaction,
  ) {
    const dialect = this.getDialectType();
    const db = dbOrTx(this.db, trx);

    const patch: any = { ...updatePageData, updated_at: new Date() };

    // content/contributor_ids 보정
    if ('content' in patch && patch.content !== undefined) {
      const safe = sanitizeContentIn(patch.content);
      patch.content =
        dialect === 'postgres' ? safe : JSON.stringify(safe);
    }
    if ('contributor_ids' in patch && patch.contributor_ids !== undefined) {
      const norm = normalizeJsonIn(patch.contributor_ids) ?? [];
      // contributor_ids는 모든 DB에서 varchar로 JSON 문자열 저장
      patch.contributor_ids = JSON.stringify(norm);
    }

    return db
      .updateTable('wiki_pages')
      .set(patch)
      .where(
        pageIds.some((pageId) => !isValidUUID(pageId)) ? 'slug_id' : 'id',
        'in',
        pageIds,
      )
      .executeTakeFirst();
  }

  async updatePage(
    updatablePage: UpdatablePage,
    pageId: string,
    trx?: KyselyTransaction,
  ) {
    return this.updatePages(updatablePage, [pageId], trx);
  }

  async insertPage(
    insertablePage: InsertablePage,
    trx?: KyselyTransaction,
  ): Promise<Page> {
    const db = dbOrTx(this.db, trx);
    const dialect = this.getDialectType();

    const toSave: any = { ...insertablePage };

    // ★ 신규 페이지는 항상 유효한 기본 문서를 저장
    const safeContent = sanitizeContentIn((insertablePage as any).content);
    toSave.content =
      dialect === 'postgres' ? safeContent : JSON.stringify(safeContent);

    // contributor_ids 정규화 - 모든 DB에서 varchar로 JSON 문자열 저장
    const normContrib =
      normalizeJsonIn((insertablePage as any).contributor_ids) ?? [];
    toSave.contributor_ids = JSON.stringify(normContrib);

    if (dialect === 'mysql' || dialect === 'oracle') {
      await db.insertInto('wiki_pages').values(toSave).execute();
      return this.findById(insertablePage.slug_id, { trx });
    } else {
      return db
        .insertInto('wiki_pages')
        .values(toSave)
        .returning(this.baseFields)
        .executeTakeFirst() as Promise<Page>;
    }
  }

  private async getDescendantPageIds(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<string[]> {
    const db = dbOrTx(this.db, trx);
    const descendants = await db
      .withRecursive('page_descendants', (db) =>
        db
          .selectFrom('wiki_pages')
          .select(['id'])
          .where('id', '=', pageId)
          .unionAll((exp) =>
            exp
              .selectFrom('wiki_pages as p')
              .select(['p.id'])
              .innerJoin('page_descendants as pd', 'pd.id', 'p.parent_page_id'),
          ),
      )
      .selectFrom('page_descendants')
      .selectAll()
      .execute();
    return descendants.map((d) => d.id);
  }

  async removePage(pageId: string, deletedById: string): Promise<void> {
    const pageIds = await this.getDescendantPageIds(pageId);
    await this.db
      .updateTable('wiki_pages')
      .set({ deleted_by_id: deletedById, deleted_at: new Date() })
      .where('id', 'in', pageIds)
      .execute();
  }

  async restorePage(pageId: string): Promise<void> {
    const pageToRestore = await this.db
      .selectFrom('wiki_pages')
      .select(['id', 'parent_page_id'])
      .where('id', '=', pageId)
      .executeTakeFirst();

    if (!pageToRestore) return;

    let shouldDetachFromParent = false;
    if (pageToRestore.parent_page_id) {
      const parent = await this.db
        .selectFrom('wiki_pages')
        .select(['id', 'deleted_at'])
        .where('id', '=', pageToRestore.parent_page_id)
        .executeTakeFirst();
      shouldDetachFromParent = parent?.deleted_at !== null;
    }

    const pageIds = await this.getDescendantPageIds(pageId);

    await this.db
      .updateTable('wiki_pages')
      .set({ deleted_by_id: null, deleted_at: null })
      .where('id', 'in', pageIds)
      .execute();

    if (shouldDetachFromParent) {
      await this.db
        .updateTable('wiki_pages')
        .set({ parent_page_id: null })
        .where('id', '=', pageId)
        .execute();
    }
  }

  async getRecentPagesInSpace(spaceId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('wiki_pages')
      .select(this.baseFields)
      .select((eb) => this.withSpace(eb))
      .where('space_id', '=', spaceId)
      .where('deleted_at', 'is', null)
      .orderBy('updated_at', 'desc');

    return executeWithPagination(query, {
      page: pagination.page,
      perPage: pagination.limit,
    });
  }

  async getRecentPages(userId: string, pagination: PaginationOptions) {
    const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);

    const query = this.db
      .selectFrom('wiki_pages')
      .select(this.baseFields)
      .select((eb) => this.withSpace(eb))
      .where('space_id', 'in', userSpaceIds)
      .where('deleted_at', 'is', null)
      .orderBy('updated_at', 'desc');

    const hasEmptyIds = userSpaceIds.length === 0;
    return executeWithPagination(query, {
      page: pagination.page,
      perPage: pagination.limit,
      hasEmptyIds,
    });
  }

  async getDeletedPagesInSpace(spaceId: string, pagination: PaginationOptions) {
    const dialect = this.getDialectType();

    const query = this.db
      .selectFrom('wiki_pages')
      .select(this.baseFields)
      .select('content')
      .select((eb) => this.withSpace(eb))
      .select((eb) => this.withDeletedBy(eb))
      .where('space_id', '=', spaceId)
      .where('deleted_at', 'is not', null)
      .where((eb) =>
        eb.or([
          eb('parent_page_id', 'is', null),
          eb.not(
            eb.exists(
              eb
                .selectFrom('wiki_pages as parent')
                .select('parent.id')
                .where('parent.id', '=', eb.ref('wiki_pages.parent_page_id'))
                .where('parent.deleted_at', 'is not', null),
            ),
          ),
        ]),
      )
      .orderBy('deleted_at', 'desc');

    const res: any = await executeWithPagination(query, {
      page: pagination.page,
      perPage: pagination.limit,
    });

    if (dialect !== 'postgres') {
      res.items?.forEach((r: any) => {
        if ('content' in r) r.content = jsonOut(r.content, DEFAULT_DOC);
        if ('space' in r) r.space = parseIfJson(r.space, null);
        if ('deletedBy' in r) r.deletedBy = parseIfJson(r.deletedBy, null);
      });
    }
    return res;
  }

  async getPageAndDescendants(
    parentPageId: string,
    opts: { includeContent: boolean },
  ) {
    const dialect = this.getDialectType();

    const rows: any[] = await this.db
      .withRecursive('page_hierarchy', (db) =>
        db
          .selectFrom('wiki_pages')
          .select([
            'id',
            'slug_id',
            'title',
            'icon',
            'position',
            'parent_page_id',
            'space_id',
            'workspace_id',
            'use_page_password',
          ])
          .$if(!!opts?.includeContent, (qb) => qb.select('content'))
          .where('id', '=', parentPageId)
          .where('deleted_at', 'is', null)
          .unionAll((exp) =>
            exp
              .selectFrom('wiki_pages as p')
              .select([
                'p.id',
                'p.slug_id',
                'p.title',
                'p.icon',
                'p.position',
                'p.parent_page_id',
                'p.space_id',
                'p.workspace_id',
                'p.use_page_password',
              ])
              .$if(!!opts?.includeContent, (qb) => qb.select('p.content'))
              .innerJoin('page_hierarchy as ph', 'p.parent_page_id', 'ph.id')
              .where('p.deleted_at', 'is', null) ,
          ),
      )
      .selectFrom('page_hierarchy')
      .selectAll()
      .execute();

    if (dialect !== 'postgres' && opts?.includeContent) {
      rows.forEach((r) => {
        r.content = jsonOut(r.content, DEFAULT_DOC);
      });
    }
    return rows;
  }

  /** ---------- 조인 JSON: 멀티-DB 분기 (SubqueryBuilder 사용) ---------- */

  withSpace(_eb: ExpressionBuilder<DB, 'wiki_pages'>) {
    // SubqueryBuilder를 사용하여 DB별 자동 처리
    return this.qb.spaceSubquery('space_id', 'wiki_pages', 's').as('space');
  }

  private withUserFields(
    _eb: ExpressionBuilder<DB, 'wiki_pages'>,
    column: 'creator_id' | 'last_updated_by_id' | 'deleted_by_id',
  ) {
    const alias = column.replace('_id', '');

    // SubqueryBuilder를 사용하여 DB별 자동 처리
    return this.qb.userSubquery(column, 'wiki_pages', 'u').as(alias);
  }

  withCreator(eb: ExpressionBuilder<DB, 'wiki_pages'>) {
    return this.withUserFields(eb, 'creator_id');
  }
  withLastUpdatedBy(eb: ExpressionBuilder<DB, 'wiki_pages'>) {
    return this.withUserFields(eb, 'last_updated_by_id');
  }
  withDeletedBy(eb: ExpressionBuilder<DB, 'wiki_pages'>) {
    return this.withUserFields(eb, 'deleted_by_id');
  }

  withContributors(_eb: ExpressionBuilder<DB, 'wiki_pages'>) {
    // SubqueryBuilder를 사용하여 DB별 자동 처리
    return this.qb.contributorsSubquery('wiki_pages').as('contributors');
  }

  async getSpacePageIndex(spaceId: string, limit?: number) {
    const dialect = this.getDialectType();
    const rowLimit = Math.min(Math.max(limit || 50, 1), 200);

    const query = this.db
      .selectFrom('wiki_pages')
      .select([
        'id',
        'slug_id',
        'title',
        'icon',
        'parent_page_id',
        'updated_at',
        'last_updated_by_id',
      ])
      .select(() =>
        this.qb.userWithOrgSubquery('last_updated_by_id', 'wiki_pages', 'u', 'ub')
          .as('last_updated_by'),
      )
      .where('space_id', '=', spaceId)
      .where('deleted_at', 'is', null)
      .orderBy('updated_at', 'desc')
      .limit(rowLimit);

    const rows: any[] = await query.execute();

    if (dialect !== 'postgres') {
      rows.forEach((r) => {
        // Kysely alias is snake_case (last_updated_by); HTTP interceptor converts to camelCase later
        if ('last_updated_by' in r)
          r.last_updated_by = parseIfJson(r.last_updated_by, null);
      });
    }

    return rows;
  }

  /**
   * 페이지 비밀번호 조회 (비밀번호 검증용)
   */
  async findPagePasswordById(pageId: string): Promise<string | null> {
    const query = this.db
      .selectFrom('wiki_pages')
      .select(['page_password'])
      .where(isValidUUID(pageId) ? 'id' : 'slug_id', '=', pageId);

    const row = await query.executeTakeFirst();
    return row?.page_password ?? null;
  }

  /**
   * 페이지 비밀번호 설정/해제
   */
  async updatePagePassword(
    pageId: string,
    usePagePassword: 'Y' | 'N',
    pagePassword: string | null,
  ): Promise<void> {
    await this.db
      .updateTable('wiki_pages')
      .set({
        use_page_password: usePagePassword,
        page_password: pagePassword,
        updated_at: new Date(),
      })
      .where(isValidUUID(pageId) ? 'id' : 'slug_id', '=', pageId)
      .execute();
  }
}
