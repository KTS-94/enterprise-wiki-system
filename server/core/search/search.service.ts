/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * Oracle LIKE 폴백 포함 멀티 DB 전문 검색
 */
import { Injectable } from '@nestjs/common';
import { SearchDTO, SearchSuggestionDTO } from './dto/search.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import type { DatabaseDialect } from '../../database/repos/dialects';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

@Injectable()
export class SearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private pageRepo: PageRepo,
    private spaceMemberRepo: SpaceMemberRepo,
    private readonly environmentService: EnvironmentService,
  ) {}

  private getDialectType(): DatabaseDialect {
    const url = this.environmentService.getDatabaseURL();
    if (url.startsWith('mysql') || url.startsWith('mariadb')) return 'mysql';
    if (url.startsWith('postgres')) return 'postgres';
    if (url.startsWith('oracle')) return 'oracle';
    return 'unknown';
  }

  async searchPage(
    query: string,
    searchParams: SearchDTO,
    opts: {
      userId?: string;
      workspaceId: string;
    },
  ): Promise<SearchResponseDto[]> {
    if (query.length < 1) return;

    const dialect = this.getDialectType();
    const trimmed = query.trim();

    let queryResults: any;

    if (dialect === 'mysql') {
      // MySQL / MariaDB: MATCH() AGAINST()
      const match = sql<number>`MATCH(${sql.ref('title')}, ${sql.ref(
        'text_content',
      )}) AGAINST (${trimmed} IN NATURAL LANGUAGE MODE)`;

      queryResults = this.db
        .selectFrom('wiki_pages')
        .select([
          'id',
          'slug_id',
          'title',
          'icon',
          'parent_page_id',
          'creator_id',
          'created_at',
          'updated_at',
          match.as('rank'),
          // MySQL에서는 하이라이트 없이 진행(선택)
        ])
        .where(match, '>', 0)
        .$if(Boolean(searchParams.creatorId), (qb) =>
          qb.where('creator_id', '=', searchParams.creatorId),
        )
        .orderBy(match, 'desc')
        .limit(searchParams.limit ?? 20)
        .offset(searchParams.offset || 0);
    } else if (dialect === 'oracle') {
      // Oracle: LIKE 검색 (Oracle Text 미사용)
      const like = `%${trimmed}%`;

      queryResults = this.db
        .selectFrom('wiki_pages')
        .select([
          'id',
          'slug_id',
          'title',
          'icon',
          'parent_page_id',
          'creator_id',
          'created_at',
          'updated_at',
          sql<number>`1`.as('rank'),
        ])
        .where((eb) =>
          eb.or([
            eb(sql`LOWER(wiki_pages.title)`, 'like', sql`LOWER(${like})`),
            eb(sql`LOWER(wiki_pages.text_content)`, 'like', sql`LOWER(${like})`),
          ]),
        )
        .$if(Boolean(searchParams.creatorId), (qb) =>
          qb.where('creator_id', '=', searchParams.creatorId),
        )
        .orderBy('updated_at', 'desc')
        .limit(searchParams.limit ?? 20)
        .offset(searchParams.offset || 0);
    } else {
      // PostgreSQL: tsvector / ts_rank
      const searchQuery = tsquery(trimmed + '*');

      const rank = sql<number>`ts_rank(
        ${sql.ref('tsv')},
        to_tsquery('english', f_unaccent(${searchQuery}))
      )`;

      const highlight = sql<string>`ts_headline(
        'english',
        text_content,
        to_tsquery('english', f_unaccent(${searchQuery})),
        'MinWords=9, MaxWords=10, MaxFragments=3'
      )`;

      queryResults = this.db
        .selectFrom('wiki_pages')
        .select([
          'id',
          'slug_id',
          'title',
          'icon',
          'parent_page_id',
          'creator_id',
          'created_at',
          'updated_at',
          rank.as('rank'),
          highlight.as('highlight'),
        ])
        .where(
          sql.ref('tsv'),
          '@@',
          sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`,
        )
        .$if(Boolean(searchParams.creatorId), (qb) =>
          qb.where('creator_id', '=', searchParams.creatorId),
        )
        .orderBy('rank', 'desc')
        .limit(searchParams.limit ?? 20)
        .offset(searchParams.offset || 0);
    }

    if (!searchParams.shareId) {
      queryResults = queryResults.select((eb) => this.pageRepo.withSpace(eb));
    }

    if (searchParams.spaceId) {
      // search by spaceId
      queryResults = queryResults.where('space_id', '=', searchParams.spaceId);
    } else if (opts.userId && !searchParams.spaceId) {
      // only search spaces the user is a member of
      const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(
        opts.userId,
      );
      if (userSpaceIds.length > 0) {
        queryResults = queryResults
          .where('space_id', 'in', userSpaceIds)
          .where('workspace_id', '=', opts.workspaceId);
      } else {
        return [];
      }
    } else {
      return [];
    }

    // @ts-ignore
    queryResults = await queryResults.execute();

    // @ts-ignore
    const searchResults = queryResults.map((result: SearchResponseDto) => {
      if ((result as any).highlight) {
        (result as any).highlight = (result as any).highlight
          .replace(/\r\n|\r|\n/g, ' ')
          .replace(/\s+/g, ' ');
      }
      return result;
    });

    return searchResults;
  }

  async searchSuggestions(
    suggestion: SearchSuggestionDTO,
    userId: string,
    workspaceId: string,
  ) {
    const dialect = this.getDialectType();

    let users: any[] = [];
    const groups: any[] = [];
    let pages: any[] = [];

    const limit = suggestion?.limit || 10;
    const q = suggestion.query.toLowerCase().trim();
    const like = `%${q}%`;

    if (suggestion.includeUsers) {
      if (dialect === 'mysql') {
        // workspaceId는 이제 회사코드(companycode)와 동일
        const rawQuery = sql`
          SELECT
            ur.usercode,
            ur.multidisplayname,
            ur.mailaddress,
            ur.photopath
          FROM covi_smart4j.sys_object_user AS ur
          INNER JOIN covi_smart4j.sys_object_user_basegroup AS bg
            ON ur.usercode = bg.usercode
          WHERE
            IFNULL(bg.jobtype, 'Origin') = 'Origin'
            AND ur.isuse = 'Y'
            AND bg.companycode = ${workspaceId}
            AND (
              LOWER(ur.multidisplayname) LIKE ${like}
              OR LOWER(ur.mailaddress) LIKE ${like}
            )
          LIMIT ${limit}
        `;

        const compiledQuery = rawQuery.compile(this.db);
        const result = await this.db.executeQuery(compiledQuery);

        users = result.rows as {
          usercode: string;
          multidisplayname: string;
          mailaddress: string;
          photopath: string;
        }[];
      } else if (dialect === 'postgres') {
        const userQuery = this.db
          .selectFrom('covi_smart4j.sys_object_user')
          .select([
            'usercode as id',
            'multidisplayname as name',
            'mailaddress as email',
            'photopath as avatarUrl',
          ])
          .innerJoin('wiki_user_settings', 'usercode', 'covi_smart4j.sys_object_user.usercode')
          .where('wiki_user_settings.workspace_id', '=', workspaceId)
          .where('wiki_user_settings.deleted_at', 'is', null)
          .where((eb) =>
            eb.or([
              eb(sql`LOWER(f_unaccent(covi_smart4j.sys_object_user.multidisplayname))`, 'like', sql`LOWER(f_unaccent(${like}))`),
              eb(sql`LOWER(f_unaccent(covi_smart4j.sys_object_user.mailaddress))`, 'like', sql`LOWER(f_unaccent(${like}))`),
            ]),
          )
          .limit(limit);

        users = await userQuery.execute();
      } else if (dialect === 'oracle') {
        const userQuery = this.db
          .selectFrom('covi_smart4j.sys_object_user')
          .select([
            'covi_smart4j.sys_object_user.usercode',
            'covi_smart4j.sys_object_user.multidisplayname',
            'covi_smart4j.sys_object_user.mailaddress',
            'covi_smart4j.sys_object_user.photopath',
          ])
          .innerJoin('wiki_user_settings', 'wiki_user_settings.usercode', 'covi_smart4j.sys_object_user.usercode')
          .where('wiki_user_settings.workspace_id', '=', workspaceId)
          .where('wiki_user_settings.deleted_at', 'is', null)
          .where((eb) =>
            eb.or([
              eb(sql`LOWER(multidisplayname)`, 'like', sql`LOWER(${like})`),
              eb(sql`LOWER(mailaddress)`, 'like', sql`LOWER(${like})`),
            ]),
          )
          .limit(limit);

        users = await userQuery.execute();
      }
    }

    /* if (suggestion.includeGroups) {
      if (dialect === 'mysql') {
        groups = await this.db
          .selectFrom('groups')
          .select(['id', 'name', 'description'])
          .where((eb) =>
            eb(sql`LOWER(groups.name)`, 'like', q),
          )
          .where('workspaceId', '=', workspaceId)
          .limit(limit)
          .execute();
      } else {
        groups = await this.db
          .selectFrom('groups')
          .select(['id', 'name', 'description'])
          .where((eb) =>
            eb(
              sql`LOWER(f_unaccent(groups.name))`,
              'like',
              sql`LOWER(f_unaccent(${like}))`,
            ),
          )
          .where('workspaceId', '=', workspaceId)
          .limit(limit)
          .execute();
      }
    } */

    if (suggestion.includePages) {
      let pageSearch;
      if (dialect === 'mysql' || dialect === 'oracle') {
        pageSearch = this.db
          .selectFrom('wiki_pages')
          .select(['id', 'slug_id', 'title', 'icon', 'space_id'])
          .where((eb) => eb(sql`LOWER(wiki_pages.title)`, 'like', like))
          .where('workspace_id', '=', workspaceId)
          .where('deleted_at', 'is', null)
          .limit(limit);
      } else {
        pageSearch = this.db
          .selectFrom('wiki_pages')
          .select(['id', 'slug_id', 'title', 'icon', 'space_id'])
          .where((eb) =>
            eb(
              sql`LOWER(f_unaccent(wiki_pages.title))`,
              'like',
              sql`LOWER(f_unaccent(${like}))`,
            ),
          )
          .where('workspace_id', '=', workspaceId)
          .limit(limit);
      }

      // only search spaces the user has access to
      const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);

      if (suggestion?.spaceId) {
        if (userSpaceIds.includes(suggestion.spaceId)) {
          pageSearch = pageSearch.where('space_id', '=', suggestion.spaceId);
          pages = await pageSearch.execute();
        }
      } else if (userSpaceIds?.length > 0) {
        pageSearch = pageSearch.where('space_id', 'in', userSpaceIds);
        pages = await pageSearch.execute();
      }
    }

    return { users, groups, pages };
  }
}
