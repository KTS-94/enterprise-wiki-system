/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 첨부파일 추적, 멘션 추출, 디바운스 저장 최적화
 */
import {
  afterUnloadDocumentPayload,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import * as Y from 'yjs';
import { Injectable, Logger } from '@nestjs/common';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { getPageId, jsonToText, tiptapExtensions } from '../collaboration.util';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import {
  extractMentions,
  extractPageMentions,
} from '../../common/helpers/prosemirror/utils';
import { isDeepStrictEqual } from 'node:util';
import { IPageBacklinkJob } from '../../integrations/queue/constants/queue.interface';
import { Page } from '@docmost/db/types/entity.types';
import { getAttachmentIds } from '../../common/helpers/prosemirror/utils'; 
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';

@Injectable()
export class PersistenceExtension implements Extension {
  private readonly logger = new Logger(PersistenceExtension.name);
  private contributors: Map<string, Set<string>> = new Map();

  constructor(
    private readonly pageRepo: PageRepo,
    private readonly attachmentRepo: AttachmentRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private eventEmitter: EventEmitter2,
    @InjectQueue(QueueName.GENERAL_QUEUE) private generalQueue: Queue,
  ) {}

  async onLoadDocument(data: onLoadDocumentPayload) {
    const { documentName, document } = data;
    const pageId = getPageId(documentName);

    if (!document.isEmpty('default')) {
      return;
    }

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
      includeYdoc: true,
    });

    if (!page) {
      this.logger.warn('page not found');
      return;
    }

    if (page.ydoc) {
      this.logger.debug(`ydoc loaded from db: ${pageId}`);

      const doc = new Y.Doc();
      const dbState = new Uint8Array(page.ydoc);

      Y.applyUpdate(doc, dbState);
      return doc;
    }

    // if no ydoc state in db convert json in page.content to Ydoc.
    if (page.content) {
      this.logger.debug(`converting json to ydoc: ${pageId}`);

      const ydoc = TiptapTransformer.toYdoc(
        page.content,
        'default',
        tiptapExtensions,
      );

      Y.encodeStateAsUpdate(ydoc);
      return ydoc;
    }

    this.logger.debug(`creating fresh ydoc: ${pageId}`);
    return new Y.Doc();
  }

  async onStoreDocument(data: onStoreDocumentPayload) {
    const { documentName, document, context } = data;

    const pageId = getPageId(documentName);

    const tiptapJson = TiptapTransformer.fromYdoc(document, 'default');
    const ydocState = Buffer.from(Y.encodeStateAsUpdate(document));

    let textContent = null;

    try {
      textContent = jsonToText(tiptapJson);
      // 연속 줄바꿈/공백을 단일 공백으로 정리 (메모리 절약, 검색 기능에는 영향 없음)
      if (textContent) {
        textContent = textContent.replace(/\s+/g, ' ').trim();
      }
    } catch (err) {
      this.logger.warn('jsonToText' + err?.['message']);
    }

    let page: Page = null;

    try {
      await executeTx(this.db, async (trx) => {
        page = await this.pageRepo.findById(pageId, {
          withLock: true,
          includeContent: true,
          trx,
        });

        if (!page) {
          this.logger.error(`Page with id ${pageId} not found`);
          return;
        }

        // 변경 내용이 없으면 저장하지 않음
        if (isDeepStrictEqual(tiptapJson, page.content)) {
          page = null;
          return;
        }

        // Attachment cleanup
        const idsInDocument = getAttachmentIds(tiptapJson); // 문서 안에 실제로 존재하는 attachment id들
        const dbAttachments = await this.attachmentRepo.findAllByPageId(pageId, { trx }); // DB에서 attachment 목록 가져오기
        for (const att of dbAttachments) {  // 문서에 없어진 attachment만 soft-delete
          if (!idsInDocument.includes(att.id)) {
            await this.attachmentRepo.softDeleteAttachment(att.id, trx);
          }
        }        
        for (const att of dbAttachments) { // 문서에는 존재하는데 deleted_at 상태였던 첨부파일 → 복원(버전 기록 복원 대비)
          if (idsInDocument.includes(att.id)) {
            if (att.deleted_at !== null) {
              await this.attachmentRepo.restoreAttachment(att.id, trx);
            }
          }
        }
        // Attachment cleanup 끝

        let contributorIds = undefined;
        try {
          const existingContributors = page.contributor_ids || [];
          const contributorSet = this.contributors.get(documentName);
          contributorSet.add(page.creator_id);
          const newContributors = [...contributorSet];
          contributorIds = Array.from(
            new Set([...existingContributors, ...newContributors]),
          );
          this.contributors.delete(documentName);
        } catch (err) {
          //this.logger.debug('Contributors error:' + err?.['message']);
        }

        await this.pageRepo.updatePage(
          {
            content: tiptapJson,
            text_content: textContent,
            ydoc: ydocState,
            last_updated_by_id: context?.user?.usercode ?? page.last_updated_by_id,
            contributor_ids: contributorIds,
          },
          pageId,
          trx,
        );

        this.logger.debug(`Page updated: ${pageId} - SlugId: ${page.slug_id}`);
      });
    } catch (err) {
      this.logger.error(`Failed to update page ${pageId}`, err);
    }

    if (page) {
      this.eventEmitter.emit('collab.page.updated', {
        page: {
          ...page,
          content: tiptapJson,
          last_updated_by_id: context?.user?.usercode ?? page.last_updated_by_id,
        },
      });

      const mentions = extractMentions(tiptapJson);
      const pageMentions = extractPageMentions(mentions);

      await this.generalQueue.add(QueueJob.PAGE_BACKLINKS, {
        pageId: pageId,
        workspaceId: page.workspace_id,
        mentions: pageMentions,
      } as IPageBacklinkJob);
    }
  }

  async onChange(data: onChangePayload) {
    // Redis 동기화로 인한 변경은 무시 (context.user가 없음)
    if (data.transactionOrigin === 'redis-sync') {
      return;
    }

    const documentName = data.documentName;
    const userId = data.context?.user?.usercode;
    if (!userId) return;

    if (!this.contributors.has(documentName)) {
      this.contributors.set(documentName, new Set());
    }

    this.contributors.get(documentName).add(userId);
  }

  async afterUnloadDocument(data: afterUnloadDocumentPayload) {
    const documentName = data.documentName;
    this.contributors.delete(documentName);
  }
}
