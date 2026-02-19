/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 페이지 비밀번호 검증, JSON 콘텐츠 정규화, 그룹웨어 연동 로직
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePageDto } from '../dto/create-page.dto';
import { UpdatePageDto } from '../dto/update-page.dto';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { InsertablePage, Page, SysObjectUser } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  executeWithPagination,
  PaginationResult,
} from '@docmost/db/pagination/pagination';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { MovePageDto } from '../dto/move-page.dto';
import { generateSlugId } from '../../../common/helpers';
import * as crypto from 'crypto';
import { executeTx } from '@docmost/db/utils';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { v7 as uuid7 } from 'uuid';
import {
  createYdocFromJson,
  getAttachmentIds,
  getProsemirrorContent,
  isAttachmentNode,
  removeMarkTypeFromDoc,
} from '../../../common/helpers/prosemirror/utils';
import { jsonToNode, jsonToText } from 'src/collaboration/collaboration.util';
import {
  CopyPageMapEntry,
  ICopyPageAttachment,
} from '../dto/duplicate-page.dto';
import { Node as PMNode } from '@tiptap/pm/model';
import { StorageService } from '../../../integrations/storage/storage.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';

@Injectable()
export class PageService {
  private readonly logger = new Logger(PageService.name);

  constructor(
    private pageRepo: PageRepo,
    private spaceRepo: SpaceRepo,
    private attachmentRepo: AttachmentRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
    private readonly environmentService: EnvironmentService,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
  ) {}

  private normalizeStringArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return (value as unknown[]).map(String);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        // 콤마 구분 문자열을 허용하고 싶다면 주석 해제
        // return value.split(',').map(s => s.trim()).filter(Boolean);
        return [];
      }
    }
    return [];
  }

  async findById(
    pageId: string,
    includeContent?: boolean,
    includeYdoc?: boolean,
    includeSpace?: boolean,
    includeTextContent?: boolean,
  ): Promise<Page> {
    return this.pageRepo.findById(pageId, {
      includeContent,
      includeYdoc,
      includeSpace,
      includeTextContent,
    });
  }

  async create(
    userId: string,
    workspaceId: string,
    createPageDto: CreatePageDto,
  ): Promise<Page> {
    let parentPageId = undefined;

    // check if parent page exists
    if (createPageDto.parentPageId) {
      const parentPage = await this.pageRepo.findById(
        createPageDto.parentPageId,
      );

      if (!parentPage || parentPage.space_id !== createPageDto.spaceId) {
        throw new NotFoundException('Parent page not found');
      }

      parentPageId = parentPage.id;
    }

    // space 정보 가져오기
    const space = await this.spaceRepo.findById(createPageDto.spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    // useApproval 값에 따라 publishStatus 설정
    const publishStatus = space.use_approval === 'N' ? 'PUBLISHED' : 'DRAFT';

    const createdPage = await this.pageRepo.insertPage({
      id: uuid7(),
      slug_id: generateSlugId(),
      title: createPageDto.title,
      position: await this.nextPagePosition(
        createPageDto.spaceId,
        parentPageId,
      ),
      icon: createPageDto.icon,
      parent_page_id: parentPageId,
      space_id: createPageDto.spaceId,
      creator_id: userId,
      owner_id: userId,
      workspace_id: workspaceId,
      last_updated_by_id: userId,
      publish_status: publishStatus,
    });

    return createdPage;
  }

  async nextPagePosition(spaceId: string, parentPageId?: string) {
    let pagePosition: string;

    const lastPageQuery = this.db
      .selectFrom('wiki_pages')
      .select(['position'])
      .where('space_id', '=', spaceId)
      .orderBy('position', 'desc')
      .limit(1);

    if (parentPageId) {
      // check for children of this page
      const lastPage = await lastPageQuery
        .where('parent_page_id', '=', parentPageId)
        .executeTakeFirst();

      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null);
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    } else {
      // for root page
      const lastPage = await lastPageQuery
        .where('parent_page_id', 'is', null)
        .executeTakeFirst();

      // if no existing page, make this the first
      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null); // we expect "a0"
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    }

    return pagePosition;
  }

  async update(
    page: Page,
    updatePageDto: UpdatePageDto,
    userId: string,
  ): Promise<Page> {
    const contributors = new Set<string>(
      this.normalizeStringArray((page as any).contributor_ids),
    );
    contributors.add(userId);
    const contributorIds = Array.from(contributors);

    await this.pageRepo.updatePage(
      {
        title: updatePageDto.title,
        icon: updatePageDto.icon,
        last_updated_by_id: userId,
        updated_at: new Date(),
        contributor_ids: contributorIds,
      },
      page.id,
    );

    return await this.pageRepo.findById(page.id, {
      includeSpace: true,
      includeContent: true,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });
  }

  async getSidebarPages(
    spaceId: string,
    pagination: PaginationOptions,
    pageId?: string,
  ): Promise<any> {
    let query = this.db
      .selectFrom('wiki_pages')
      .select([
        'id',
        'slug_id',
        'title',
        'icon',
        'position',
        'parent_page_id',
        'space_id',
        'creator_id',
        'deleted_at',
      ])
      .select((eb) => this.pageRepo.withHasChildren(eb))
      .orderBy('position', 'asc')
      .where('deleted_at', 'is', null)
      .where('space_id', '=', spaceId);

    if (pageId) {
      query = query.where('parent_page_id', '=', pageId);
    } else {
      query = query.where('parent_page_id', 'is', null);
    }

    const result = executeWithPagination(query, {
      page: pagination.page,
      perPage: 250,
    });

    return result;
  }

  async movePageToSpace(rootPage: Page, spaceId: string) {
    await executeTx(this.db, async (trx) => {
      // Update root page
      const nextPosition = await this.nextPagePosition(spaceId);
      await this.pageRepo.updatePage(
        { space_id: spaceId, parent_page_id: null, position: nextPosition },
        rootPage.id,
        trx,
      );
      const pageIds = await this.pageRepo
        .getPageAndDescendants(rootPage.id, { includeContent: false })
        .then((pages) => pages.map((page) => page.id));
      // The first id is the root page id
      if (pageIds.length > 1) {
        // Update sub pages
        await this.pageRepo.updatePages(
          { space_id: spaceId },
          pageIds.filter((id) => id !== rootPage.id),
          trx,
        );
      }

      // Update attachments
      await this.attachmentRepo.updateAttachmentsByPageId(
        { space_id: spaceId },
        pageIds,
        trx,
      );
    });
  }

  async duplicatePage(
    rootPage: Page,
    targetSpaceId: string | undefined,
    authUser: SysObjectUser,
  ) {
    const spaceId = targetSpaceId || rootPage.space_id;
    const isDuplicateInSameSpace =
      !targetSpaceId || targetSpaceId === rootPage.space_id;

    let nextPosition: string;

    if (isDuplicateInSameSpace) {
      // For duplicate in same space, position right after the original page
      let siblingQuery = this.db
        .selectFrom('wiki_pages')
        .select(['position'])
        .where('space_id', '=', rootPage.space_id)
        .where('position', '>', rootPage.position);

      if (rootPage.parent_page_id) {
        siblingQuery = siblingQuery.where(
          'parent_page_id',
          '=',
          rootPage.parent_page_id,
        );
      } else {
        siblingQuery = siblingQuery.where('parent_page_id', 'is', null);
      }

      const nextSibling = await siblingQuery
        .orderBy('position', 'asc')
        .limit(1)
        .executeTakeFirst();

      if (nextSibling) {
        // Fractional indexing requires a < b, but SQL string comparison differs from library comparison
        // If position data is inconsistent, fall back to appending after rootPage
        try {
          nextPosition = generateJitteredKeyBetween(
            rootPage.position,
            nextSibling.position,
          );
        } catch (err) {
          this.logger.warn(
            `Position inconsistency detected: ${rootPage.position} vs ${nextSibling.position}. Falling back to append position.`,
          );
          nextPosition = generateJitteredKeyBetween(rootPage.position, null);
        }
      } else {
        nextPosition = generateJitteredKeyBetween(rootPage.position, null);
      }
    } else {
      // For copy to different space, position at the end
      nextPosition = await this.nextPagePosition(spaceId);
    }

    const allPages = await this.pageRepo.getPageAndDescendants(rootPage.id, {
      includeContent: true,
    });

    // 비밀번호 사용 페이지와 그 하위 페이지를 제외한 페이지만 필터링
    const excludedPageIds = new Set<string>();

    // 비밀번호 페이지 ID 수집 (루트 페이지가 아닌 하위 페이지 중에서)
    allPages.forEach((page) => {
      if (page.id !== rootPage.id && page.use_page_password === 'Y') {
        excludedPageIds.add(page.id);
      }
    });

    // 비밀번호 페이지의 하위 페이지도 제외 대상에 추가
    // 반복적으로 하위 페이지를 찾아서 제외
    let hasNewExclusions = true;
    while (hasNewExclusions) {
      hasNewExclusions = false;
      allPages.forEach((page) => {
        if (!excludedPageIds.has(page.id) && page.parent_page_id && excludedPageIds.has(page.parent_page_id)) {
          excludedPageIds.add(page.id);
          hasNewExclusions = true;
        }
      });
    }

    // 필터링된 페이지 목록
    const pages = allPages.filter((page) => !excludedPageIds.has(page.id));

    // space 정보 가져오기
    const space = await this.spaceRepo.findById(spaceId, rootPage.workspace_id);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    // useApproval 값에 따라 publishStatus 설정
    const publishStatus = space.use_approval === 'N' ? 'PUBLISHED' : 'DRAFT';

    const pageMap = new Map<string, CopyPageMapEntry>();
    pages.forEach((page) => {
      pageMap.set(page.id, {
        newPageId: uuid7(),
        newSlugId: generateSlugId(),
        oldSlugId: page.slug_id,
      });
    });

    const attachmentMap = new Map<string, ICopyPageAttachment>();

    const insertablePages: InsertablePage[] = await Promise.all(
      pages.map(async (page) => {
        const pageContent = getProsemirrorContent(page.content);
        const pageFromMap = pageMap.get(page.id);

        const doc = jsonToNode(pageContent);
        const prosemirrorDoc = removeMarkTypeFromDoc(doc, 'comment');

        const attachmentIds = getAttachmentIds(prosemirrorDoc.toJSON());

        if (attachmentIds.length > 0) {
          attachmentIds.forEach((attachmentId: string) => {
            const newPageId = pageFromMap.newPageId;
            const newAttachmentId = uuid7();
            attachmentMap.set(attachmentId, {
              newPageId: newPageId,
              oldPageId: page.id,
              oldAttachmentId: attachmentId,
              newAttachmentId: newAttachmentId,
            });

            prosemirrorDoc.descendants((node: PMNode) => {
              if (isAttachmentNode(node.type.name)) {
                if (node.attrs.attachmentId === attachmentId) {
                  // @ts-ignore
                  node.attrs.attachmentId = newAttachmentId;

                  if (node.attrs.src) {
                    // @ts-ignore
                    node.attrs.src = node.attrs.src.replace(
                      attachmentId,
                      newAttachmentId,
                    );
                  }
                  if (node.attrs.src) {
                    // @ts-ignore
                    node.attrs.src = node.attrs.src.replace(
                      attachmentId,
                      newAttachmentId,
                    );
                  }
                }
              }
            });
          });
        }

        // Update internal page links in mention nodes
        prosemirrorDoc.descendants((node: PMNode) => {
          if (
            node.type.name === 'mention' &&
            node.attrs.entityType === 'page'
          ) {
            const referencedPageId = node.attrs.entityId;

            // Check if the referenced page is within the pages being copied
            if (referencedPageId && pageMap.has(referencedPageId)) {
              const mappedPage = pageMap.get(referencedPageId);
              // @ts-ignore
              node.attrs.entityId = mappedPage.newPageId;
              // @ts-ignore
              node.attrs.slugId = mappedPage.newSlugId;
            }
          }
        });

        const prosemirrorJson = prosemirrorDoc.toJSON();

        // Add "Copy of " prefix to the root page title only for duplicates in same space
        let title = page.title;
        if (isDuplicateInSameSpace && page.id === rootPage.id) {
          const originalTitle = page.title || 'Untitled';
          title = `Copy of ${originalTitle}`;
        }

        return {
          id: pageFromMap.newPageId,
          slug_id: pageFromMap.newSlugId,
          title: title,
          icon: page.icon,
          content: JSON.stringify(prosemirrorJson),
          text_content: jsonToText(prosemirrorJson),
          ydoc: createYdocFromJson(prosemirrorJson),
          position: page.id === rootPage.id ? nextPosition : page.position,
          space_id: spaceId,
          workspace_id: page.workspace_id,
          creator_id: authUser.usercode,
          owner_id: authUser.usercode,
          last_updated_by_id: authUser.usercode,
          contributor_ids: JSON.stringify([authUser.usercode]),
          publish_status: publishStatus,
          parent_page_id:
          page.id === rootPage.id
            ? (isDuplicateInSameSpace ? rootPage.parent_page_id : null) // 다른 space로 복제 시 루트는 null
            : page.parent_page_id && pageMap.has(page.parent_page_id)
            ? pageMap.get(page.parent_page_id).newPageId
            : null,
        };
      }),
    );

    await this.db.insertInto('wiki_pages').values(insertablePages).execute();

    //TODO: best to handle this in a queue
    const attachmentsIds = Array.from(attachmentMap.keys());
    if (attachmentsIds.length > 0) {
      const attachments = await this.db
        .selectFrom('wiki_attachments')
        .selectAll()
        .where('id', 'in', attachmentsIds)
        .where('workspace_id', '=', rootPage.workspace_id)
        .execute();

      for (const attachment of attachments) {
        try {
          const pageAttachment = attachmentMap.get(attachment.id);

          // make sure the copied attachment belongs to the page it was copied from
          if (attachment.page_id !== pageAttachment.oldPageId) {
            continue;
          }

          const newAttachmentId = pageAttachment.newAttachmentId;

          const newPageId = pageAttachment.newPageId;

          const newPathFile = attachment.file_path.replace(
            attachment.id,
            newAttachmentId,
          );
          await this.storageService.copy(attachment.file_path, newPathFile);
          await this.db
            .insertInto('wiki_attachments')
            .values({
              id: newAttachmentId,
              type: attachment.type,
              file_path: newPathFile,
              file_name: attachment.file_name,
              file_size: attachment.file_size,
              mime_type: attachment.mime_type,
              file_ext: attachment.file_ext,
              creator_id: attachment.creator_id,
              workspace_id: attachment.workspace_id,
              page_id: newPageId,
              space_id: spaceId,
            })
            .execute();
        } catch (err) {
          this.logger.log(err);
        }
      }
    }

    const newPageId = pageMap.get(rootPage.id).newPageId;
    const duplicatedPage = await this.pageRepo.findById(newPageId, {
      includeSpace: true,
    });

    const hasChildren = pages.length > 1;

    return {
      ...duplicatedPage,
      hasChildren,
    };
  }

  async movePage(dto: MovePageDto, movedPage: Page) {
    // validate position value by attempting to generate a key
    try {
      generateJitteredKeyBetween(dto.position, null);
    } catch (err) {
      throw new BadRequestException('Invalid move position');
    }

    let parentPageId = null;
    if (movedPage.parent_page_id === dto.parentPageId) {
      parentPageId = undefined;
    } else {
      // changing the page's parent
      if (dto.parentPageId) {
        const parentPage = await this.pageRepo.findById(dto.parentPageId);
        if (!parentPage || parentPage.space_id !== movedPage.space_id) {
          throw new NotFoundException('Parent page not found');
        }
        parentPageId = parentPage.id;
      }
    }

    await this.pageRepo.updatePage(
      {
        position: dto.position,
        parent_page_id: parentPageId,
      },
      dto.pageId,
    );
  }

  async getPageBreadCrumbs(childPageId: string) {
    const ancestors = await this.db
      .withRecursive('page_ancestors', (db) =>
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
            'deleted_at',
          ])
          .select((eb) => this.pageRepo.withHasChildren(eb))
          .where('id', '=', childPageId)
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
                'p.deleted_at',
              ])
              .select(
                exp
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
                  .whereRef('child.parent_page_id', '=', 'id')
                  .where('child.deleted_at', 'is', null)
                  .limit(1)
                  .as('hasChildren'),
              )
              //.select((eb) => this.withHasChildren(eb))
              .innerJoin('page_ancestors as pa', 'pa.parent_page_id', 'p.id')
              .where('p.deleted_at', 'is', null),
          ),
      )
      .selectFrom('page_ancestors')
      .selectAll()
      .execute();

    return ancestors.reverse();
  }

  async getRecentSpacePages(
    spaceId: string,
    pagination: PaginationOptions,
  ): Promise<PaginationResult<Page>> {
    return await this.pageRepo.getRecentPagesInSpace(spaceId, pagination) as unknown as PaginationResult<Page>;
  }

  async getRecentPages(
    userId: string,
    pagination: PaginationOptions,
  ): Promise<PaginationResult<Page>> {
    return await this.pageRepo.getRecentPages(userId, pagination) as unknown as PaginationResult<Page>;
  }

  async getSpacePageIndex(spaceId: string, limit?: number) {
    return this.pageRepo.getSpacePageIndex(spaceId, limit);
  }

  async getDeletedSpacePages(
    spaceId: string,
    pagination: PaginationOptions,
  ): Promise<PaginationResult<Page>> {
    return await this.pageRepo.getDeletedPagesInSpace(spaceId, pagination);
  }

  async forceDelete(pageId: string): Promise<void> {
    // Get all descendant IDs (including the page itself) using recursive CTE
    const descendants = await this.db
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

    const pageIds = descendants.map((d) => d.id);

    // Queue attachment deletion for all pages with unique job IDs to prevent duplicates
    for (const id of pageIds) {
      await this.attachmentQueue.add(
        QueueJob.DELETE_PAGE_ATTACHMENTS,
        {
          pageId: id,
        },
        {
          jobId: `delete-page-attachments-${id}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );
    }

    if (pageIds.length > 0) {
      await this.db.deleteFrom('wiki_pages').where('id', 'in', pageIds).execute();
    }
  }

  async remove(pageId: string, userId: string): Promise<void> {
    await this.pageRepo.removePage(pageId, userId);
  }

  /**
   * 페이지 비밀번호 검증 (SHA-512 + 글로벌 솔트)
   * 하위 호환: 글로벌 솔트가 없으면 SHA-256으로 검증 (기존 비밀번호)
   */
  async verifyPagePassword(pageId: string, password: string): Promise<boolean> {
    const page = await this.pageRepo.findById(pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    // 비밀번호 보호되지 않은 페이지는 항상 true
    if (page.use_page_password !== 'Y') {
      return true;
    }

    const storedHash = await this.pageRepo.findPagePasswordById(pageId);

    if (!storedHash) {
      return true; // 해시가 없으면 보호되지 않은 것으로 처리
    }

    const globalSalt = this.environmentService.getPagePasswordSalt();

    // 글로벌 솔트가 설정되어 있으면 SHA-512 + 솔트, 없으면 SHA-256 (하위 호환)
    if (globalSalt) {
      // SHA-512 + 글로벌 솔트 검증
      const inputHash = crypto
        .createHash('sha512')
        .update(password + globalSalt)
        .digest('hex')
        .toUpperCase();

      return inputHash === storedHash.toUpperCase();
    } else {
      // 하위 호환: SHA-256 검증 (기존 비밀번호)
      const inputHash = crypto
        .createHash('sha256')
        .update(password)
        .digest('hex')
        .toUpperCase();

      return inputHash === storedHash.toUpperCase();
    }
  }

  /**
   * 비밀번호 해시 생성 (SHA-512 + 글로벌 솔트)
   * 글로벌 솔트가 없으면 SHA-256 사용 (하위 호환)
   */
  generatePasswordHash(password: string): string {
    const globalSalt = this.environmentService.getPagePasswordSalt();

    if (globalSalt) {
      // SHA-512 + 글로벌 솔트
      return crypto
        .createHash('sha512')
        .update(password + globalSalt)
        .digest('hex')
        .toUpperCase();
    } else {
      // 하위 호환: SHA-256
      return crypto
        .createHash('sha256')
        .update(password)
        .digest('hex')
        .toUpperCase();
    }
  }

  /**
   * 페이지 비밀번호 설정
   */
  async setPagePassword(pageId: string, password: string): Promise<void> {
    const page = await this.pageRepo.findById(pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const hash = this.generatePasswordHash(password);

    await this.pageRepo.updatePagePassword(pageId, 'Y', hash);
  }

  /**
   * 페이지 비밀번호 해제
   */
  async removePagePassword(pageId: string): Promise<void> {
    const page = await this.pageRepo.findById(pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageRepo.updatePagePassword(pageId, 'N', null);
  }
}
