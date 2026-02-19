import {
  Injectable,
  Logger,
} from '@nestjs/common';

import { PageService } from '@core/page/services/page.service';
import { SysObjectUser } from '@docmost/db/types/entity.types';
import { getExportExtension } from '../../../integrations/export/utils';
import { getMimeType, LOCAL_STORAGE_PATH } from '@common/helpers';
import { sanitize } from 'sanitize-filename-ts';
import * as path from 'path';
import { ExportService } from '../../../integrations/export/export.service';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  StorageOption,
} from '../../../integrations/storage/interfaces';
import { FastifyReply } from 'fastify';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';

import {
  GwCreatePageDto,
  GwDeletePageDto,
  GwDuplicatePageDto,
  GwMovePageDto,
  GwMoveToSpaceDto,
  GwUpdatePageDto,
} from '@gw/page/dto/gw-page.dto';

import SpaceAbilityFactory from '@core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '@core/casl/interfaces/space-ability.type';
import { FileTokenService } from '../../file-token.service';

// 그룹웨어 공통 응답 타입
export interface GwResponse<T = any> {
  status: 'SUCCESS' | 'FAIL';
  message?: string;
  data?: T;
}

@Injectable()
export class GwService {
  private readonly logger = new Logger(GwService.name);

  constructor(
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly exportService: ExportService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly environmentService: EnvironmentService,
    private readonly fileTokenService: FileTokenService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  // 성공 응답 헬퍼
  private success<T>(data?: T, message?: string): GwResponse<T> {
    return { status: 'SUCCESS', data, message };
  }

  // 실패 응답 헬퍼
  private fail(message: string): GwResponse {
    return { status: 'FAIL', message };
  }

  // 권한 체크 (boolean 반환)
  private async canAccess(
    user: SysObjectUser,
    spaceId: string,
    action: SpaceCaslAction,
    subject: SpaceCaslSubject,
  ): Promise<boolean> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    return ability.can(action, subject);
  }

  async create(user: SysObjectUser, workspaceId: string, dto: GwCreatePageDto): Promise<GwResponse> {
    if (!await this.canAccess(user, dto.spaceId, SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      return this.fail('페이지 생성 권한이 없습니다.');
    }

    const page = await this.pageService.create(user.usercode, workspaceId, {
      spaceId: dto.spaceId,
      parentPageId: dto.parentPageId ?? null,
      title: dto.title ?? '',
      icon: dto.icon,
    } as any);
    return this.success(page);
  }

  async update(user: SysObjectUser, dto: GwUpdatePageDto): Promise<GwResponse> {
    const page = await this.pageService.findById(dto.pageId);
    if (!page) return this.fail('페이지를 찾을 수 없습니다.');

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      return this.fail('페이지 수정 권한이 없습니다.');
    }

    const updated = await this.pageService.update(page, dto as any, user.usercode);
    return this.success(updated);
  }

  async move(user: SysObjectUser, dto: GwMovePageDto): Promise<GwResponse> {
    const movedPage = await this.pageService.findById(dto.pageId);
    if (!movedPage) return this.fail('페이지를 찾을 수 없습니다.');

    const currentSpaceId = movedPage.space_id;
    const targetSpaceId = dto.spaceId || currentSpaceId;
    const isSpaceChange = targetSpaceId !== currentSpaceId;

    // 권한 체크
    if (!await this.canAccess(user, currentSpaceId, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      return this.fail('페이지 이동 권한이 없습니다.');
    }

    if (isSpaceChange) {
      if (!await this.canAccess(user, targetSpaceId, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        return this.fail('대상 스페이스 편집 권한이 없습니다.');
      }
    }

    // position 계산
    let beforePos: string | null = null;
    let afterPos: string | null = null;

    if (dto.beforePageId) {
      const beforePage = await this.pageService.findById(dto.beforePageId);
      if (beforePage) {
        beforePos = beforePage.position;
      }
    }

    if (dto.afterPageId) {
      const afterPage = await this.pageService.findById(dto.afterPageId);
      if (afterPage) {
        afterPos = afterPage.position;
      }
    }

    let newPosition: string;
    try {
      if (beforePos && afterPos) {
        // 두 페이지 사이에 배치
        newPosition = generateJitteredKeyBetween(beforePos, afterPos);
      } else if (beforePos) {
        // 맨 뒤에 배치 (beforePos 다음)
        newPosition = generateJitteredKeyBetween(beforePos, null);
      } else if (afterPos) {
        // 맨 앞에 배치 (afterPos 이전)
        newPosition = generateJitteredKeyBetween(null, afterPos);
      } else {
        // 부모 안에 아무 페이지도 없는 경우
        newPosition = generateJitteredKeyBetween(null, null);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Position calculation error: ${errMsg}. Falling back to append position.`);
      // 에러 발생 시 맨 뒤에 추가
      newPosition = await this.pageService.nextPagePosition(
        targetSpaceId,
        dto.parentPageId || null,
      );
    }

    // 대상 space의 승인 사용 여부 조회
    const targetSpace = await this.spaceRepo.findById(targetSpaceId, movedPage.workspace_id);
    const approvalRequired = targetSpace?.use_approval === 'Y';
    const needDraft = approvalRequired && isSpaceChange;
    const publishStatus = needDraft ? 'DRAFT' : 'PUBLISHED';

    // 하위 페이지 ID 조회
    const allPages = await this.pageRepo.getPageAndDescendants(dto.pageId, { includeContent: false });
    const allPageIds = allPages.map((p) => p.id);

    // 루트 페이지 업데이트
    const newParentPageId = dto.parentPageId === undefined
      ? movedPage.parent_page_id
      : (dto.parentPageId || null);

    await this.db
      .updateTable('wiki_pages')
      .set({
        parent_page_id: newParentPageId,
        position: newPosition,
        space_id: targetSpaceId,
        publish_status: publishStatus,
        updated_at: new Date(),
      })
      .where('id', '=', dto.pageId)
      .execute();

    // 하위 페이지들 space_id 업데이트 (space 변경 시)
    if (isSpaceChange && allPageIds.length > 1) {
      const subPageIds = allPageIds.filter((id) => id !== dto.pageId);
      await this.db
        .updateTable('wiki_pages')
        .set({
          space_id: targetSpaceId,
          publish_status: publishStatus,
          updated_at: new Date(),
        })
        .where('id', 'in', subPageIds)
        .execute();
    }

    // 첨부파일 space_id 업데이트 (space 변경 시)
    if (isSpaceChange && allPageIds.length > 0) {
      await this.db
        .updateTable('wiki_attachments')
        .set({ space_id: targetSpaceId })
        .where('page_id', 'in', allPageIds)
        .execute();
    }

    // 결과 조회
    const updatedPage = await this.pageService.findById(dto.pageId, false, false, true);
    return this.success(updatedPage);
  }

  async remove(user: SysObjectUser, dto: GwDeletePageDto): Promise<GwResponse> {
    const page = await this.pageService.findById(dto.pageId);
    if (!page) return this.success(null, '이미 삭제된 페이지입니다.'); // 멱등

    if (dto.permanentlyDelete) {
      if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
        return this.fail('영구 삭제 권한이 없습니다.');
      }
      await this.pageService.forceDelete(dto.pageId);
      return this.success(null, '페이지가 영구 삭제되었습니다.');
    }

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      return this.fail('페이지 삭제 권한이 없습니다.');
    }

    await this.pageService.remove(dto.pageId, user.usercode);
    return this.success(null, '페이지가 휴지통으로 이동되었습니다.');
  }

  async info(user: SysObjectUser, pageId: string): Promise<GwResponse> {
    const page = await this.pageService.findById(pageId, true, false, true);
    if (!page) return this.fail('페이지를 찾을 수 없습니다.');

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      return this.fail('페이지 조회 권한이 없습니다.');
    }

    return this.success(page);
  }

  async breadcrumbs(user: SysObjectUser, pageId: string): Promise<GwResponse> {
    const page = await this.pageService.findById(pageId);
    if (!page) return this.fail('페이지를 찾을 수 없습니다.');

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      return this.fail('페이지 조회 권한이 없습니다.');
    }

    const breadcrumbs = await this.pageService.getPageBreadCrumbs(pageId);
    return this.success(breadcrumbs);
  }

  async sidebarTree(
    user: SysObjectUser,
    spaceId: string,
    page = 1,
    perPage = 250,
    parentPageId?: string | null,
  ): Promise<GwResponse> {
    if (!await this.canAccess(user, spaceId, SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      return this.fail('스페이스 조회 권한이 없습니다.');
    }

    const result = await this.pageService.getSidebarPages(
      spaceId,
      { page, perPage } as any,
      parentPageId ?? null,
    );
    return this.success(result);
  }

  async recent(user: SysObjectUser, spaceId?: string, page = 1, perPage = 50): Promise<GwResponse> {
    if (spaceId) {
      if (!await this.canAccess(user, spaceId, SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        return this.fail('스페이스 조회 권한이 없습니다.');
      }
      const result = await this.pageService.getRecentSpacePages(spaceId, { page, perPage } as any);
      return this.success(result);
    }

    const result = await this.pageService.getRecentPages(user.usercode, { page, perPage } as any);
    return this.success(result);
  }

  async trash(user: SysObjectUser, spaceId: string, page = 1, perPage = 50): Promise<GwResponse> {
    if (!await this.canAccess(user, spaceId, SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      return this.fail('휴지통 조회 권한이 없습니다.');
    }

    const result = await this.pageService.getDeletedSpacePages(spaceId, { page, perPage } as any);
    return this.success(result);
  }

  async duplicate(user: SysObjectUser, dto: GwDuplicatePageDto): Promise<GwResponse> {
    const page = await this.pageService.findById(dto.pageId);
    if (!page) return this.fail('복사할 페이지를 찾을 수 없습니다.');

    if (dto.spaceId) {
      if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        return this.fail('원본 페이지 접근 권한이 없습니다.');
      }
      if (!await this.canAccess(user, dto.spaceId, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        return this.fail('대상 스페이스 편집 권한이 없습니다.');
      }
      const duplicated = await this.pageService.duplicatePage(page, dto.spaceId, user);
      return this.success(duplicated);
    }

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      return this.fail('페이지 복사 권한이 없습니다.');
    }

    const duplicated = await this.pageService.duplicatePage(page, undefined, user);
    return this.success(duplicated);
  }

  async moveToSpace(user: SysObjectUser, dto: GwMoveToSpaceDto): Promise<GwResponse> {
    const page = await this.pageService.findById(dto.pageId);
    if (!page) return this.fail('이동할 페이지를 찾을 수 없습니다.');

    if (page.space_id === dto.spaceId) {
      return this.fail('이미 해당 스페이스에 있는 페이지입니다.');
    }

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      return this.fail('원본 스페이스 편집 권한이 없습니다.');
    }
    if (!await this.canAccess(user, dto.spaceId, SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      return this.fail('대상 스페이스 편집 권한이 없습니다.');
    }

    const moved = await this.pageService.movePageToSpace(page, dto.spaceId);
    return this.success(moved);
  }

  async exportPage(
    user: SysObjectUser,
    dto: { pageId: string; format: string; includeChildren?: boolean },
    res: FastifyReply,
  ) {
    const page = await this.pageService.findById(dto.pageId, true);
    if (!page) {
      res.header('Content-Type', 'application/json; charset=utf-8');
      return res.send(this.fail('페이지를 찾을 수 없습니다.'));
    }

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      res.header('Content-Type', 'application/json; charset=utf-8');
      return res.send(this.fail('페이지 내보내기 권한이 없습니다.'));
    }

    const fileExt = getExportExtension(dto.format);
    const fileName = sanitize(page.title || 'untitled') + fileExt;

    if (dto.includeChildren) {
      const zipFileBuffer = await this.exportService.exportPageWithChildren(dto.pageId, dto.format);
      const newName = path.parse(fileName).name + '.zip';

      res.header('Content-Type', 'application/zip');
      res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(newName)}"`);
      res.header('Access-Control-Expose-Headers', 'Content-Disposition');
      return res.send(zipFileBuffer);
    }

    const rawContent = await this.exportService.exportPage(dto.format, page, true);

    res.header('Content-Type', getMimeType(fileExt));
    res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.header('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(rawContent);
  }

  async exportSpace(
    user: SysObjectUser,
    dto: { spaceId: string; format: string; includeAttachments?: boolean },
    res: FastifyReply,
  ) {
    if (!await this.canAccess(user, dto.spaceId, SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      res.header('Content-Type', 'application/json; charset=utf-8');
      return res.send(this.fail('스페이스 내보내기 권한이 없습니다.'));
    }

    const exportFile = await this.exportService.exportSpace(
      dto.spaceId,
      dto.format,
      dto.includeAttachments ?? false,
    );

    res.header('Content-Type', 'application/zip');
    res.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(sanitize(exportFile.fileName))}"`
    );
    res.header('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(exportFile.fileBuffer);
  }

  async contentToHtmlPage(
    user: SysObjectUser,
    dto: { pageId: string; },
    res: FastifyReply,
  ) {
    const page = await this.pageService.findById(dto.pageId, true, false, true, true);
    if (!page) {
      res.header('Content-Type', 'application/json; charset=utf-8');
      return res.send(this.fail('페이지를 찾을 수 없습니다.'));
    }

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      res.header('Content-Type', 'application/json; charset=utf-8');
      return res.send(this.fail('페이지 조회 권한이 없습니다.'));
    }

    const html = await this.exportService.exportPageHtml(page);

    // 첨부파일 가져오기
    const attachments = await this.attachmentRepo.findByPageId(dto.pageId);
    const driver = this.environmentService.getStorageDriver().toLowerCase();
    const baseUrl = this.environmentService.getAppUrl();

    // 각 attachment에 대한 URL 생성 (파일 토큰 포함)
    const attachmentsUrls = attachments.map((attachment) => {
      const fileToken = this.fileTokenService.generateToken(attachment.id, user.usercode);
      return `${baseUrl}/coviwiki/api/gw/files/${attachment.id}?fileToken=${encodeURIComponent(fileToken)}`;
    });

    res.header('Content-Type', 'application/json; charset=utf-8');
    return res.send(this.success({
      title: page.title,
      html: html,
      textContent: page.text_content?.replace(/\n/g, ''),
      attachments: attachments,
      attachmentsUrls: attachmentsUrls,
      storage: {
        driver, // "local" | "s3"
        ...(driver === StorageOption.LOCAL
          ? {
              localPath: LOCAL_STORAGE_PATH,
            }
          : {
              region: this.environmentService.getAwsS3Region(),
              endpoint: this.environmentService.getAwsS3Endpoint(),
              bucket: this.environmentService.getAwsS3Bucket(),
              baseUrl: this.environmentService.getAwsS3Url(),
              forcePathStyle: this.environmentService.getAwsS3ForcePathStyle(),
            })
      }
    }));
  }

  /**
   * 페이지 비밀번호 설정 (SHA-512 + 솔트)
   */
  async setPagePassword(user: SysObjectUser, pageId: string, password: string): Promise<GwResponse> {
    const page = await this.pageService.findById(pageId);
    if (!page) return this.fail('페이지를 찾을 수 없습니다.');

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      return this.fail('비밀번호 설정 권한이 없습니다.');
    }

    await this.pageService.setPagePassword(pageId, password);
    return this.success(null, '비밀번호가 설정되었습니다.');
  }

  /**
   * 페이지 비밀번호 해제
   */
  async removePagePassword(user: SysObjectUser, pageId: string): Promise<GwResponse> {
    const page = await this.pageService.findById(pageId);
    if (!page) return this.fail('페이지를 찾을 수 없습니다.');

    if (!await this.canAccess(user, page.space_id, SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      return this.fail('비밀번호 해제 권한이 없습니다.');
    }

    await this.pageService.removePagePassword(pageId);
    return this.success(null, '비밀번호가 해제되었습니다.');
  }

}
