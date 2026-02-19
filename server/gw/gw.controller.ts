import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/decorators/auth-user.decorator';
import { AuthCompanyCode } from '../common/decorators/auth-company-code.decorator';
import { Public } from '../common/decorators/public.decorator';

import { SysObjectUser } from '@docmost/db/types/entity.types';

import { GwService } from '../gw/page/services/gw.service';
import { FileTokenService } from './file-token.service';
import { FastifyReply } from 'fastify';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { TemplateRepo } from '@docmost/db/repos/template/template.repo';
import { StorageService } from '../integrations/storage/storage.service';
import SpaceAbilityFactory from '../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../core/casl/interfaces/space-ability.type';
import { inlineFileExtensions } from '../core/attachment/attachment.constants';
import { validate as isValidUUID } from 'uuid';

import {
  GwCreatePageDto,
  GwDeletePageDto,
  GwDuplicatePageDto,
  GwMovePageDto,
  GwMoveToSpaceDto,
  GwUpdatePageDto,
} from './page/dto/gw-page.dto';

@UseGuards(JwtAuthGuard)
@Controller('gw')
export class GwController {
  constructor(
    private readonly gw: GwService,
    private readonly fileTokenService: FileTokenService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly templateRepo: TemplateRepo,
    private readonly storageService: StorageService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  ////////////////////////////////////////////// 페이지관련 api //////////////////////////////////////////////
  @Post('pages')
  create(
    @Body() dto: GwCreatePageDto,
    @AuthUser() user: SysObjectUser,
    @AuthCompanyCode() workspaceId: string,
  ) {
    return this.gw.create(user, workspaceId, dto);
  }

  @Patch('pages/:pageId')
  update(
    @Param('pageId') pageId: string,
    @Body() body: Omit<GwUpdatePageDto, 'pageId'>,
    @AuthUser() user: SysObjectUser,
  ) {
    return this.gw.update(user, { pageId, ...body });
  }

  @Delete('pages/:pageId')
  remove(
    @Param('pageId') pageId: string,
    @Body() body: { permanentlyDelete?: boolean },
    @AuthUser() user: SysObjectUser,
  ) {
    return this.gw.remove(user, { pageId, permanentlyDelete: !!body?.permanentlyDelete } as GwDeletePageDto);
  }

  @Post('pages/:pageId/move')
  move(
    @Param('pageId') pageId: string,
    @Body() body: Omit<GwMovePageDto, 'pageId'>,
    @AuthUser() user: SysObjectUser,
  ) {
    return this.gw.move(user, { pageId, ...body });
  }

  @Post('pages/:pageId/duplicate')
  duplicate(
    @Param('pageId') pageId: string,
    @Body() body: Omit<GwDuplicatePageDto, 'pageId'>,
    @AuthUser() user: SysObjectUser,
  ) {
    return this.gw.duplicate(user, { pageId, ...body });
  }

  @Post('pages/:pageId/move-to-space')
  moveToSpace(
    @Param('pageId') pageId: string,
    @Body() body: Omit<GwMoveToSpaceDto, 'pageId'>,
    @AuthUser() user: SysObjectUser,
  ) {
    return this.gw.moveToSpace(user, { pageId, ...body });
  }

  @Get('pages/:pageId')
  info(
    @Param('pageId') pageId: string,
    @AuthUser() user: SysObjectUser,
  ) {
    return this.gw.info(user, pageId);
  }

  @Get('pages/:pageId/breadcrumbs')
  breadcrumbs(
    @Param('pageId') pageId: string,
    @AuthUser() user: SysObjectUser,
  ) {
    return this.gw.breadcrumbs(user, pageId);
  }

  @Get('spaces/:spaceId/tree')
  tree(
    @AuthUser() user: SysObjectUser,
    @Param('spaceId') spaceId: string,
    @Query('parentPageId') parentPageId?: string,
    @Query('page') page = 1,
    @Query('perPage') perPage = 250,
  ) {
    return this.gw.sidebarTree(
      user,
      spaceId,
      Number(page),
      Number(perPage),
      parentPageId ?? null,
    );
  }

  @Get('pages/recent')
  recent(
    @AuthUser() user: SysObjectUser,
    @Query('spaceId') spaceId?: string,
    @Query('page') page = 1,
    @Query('perPage') perPage = 50,
  ) {
    return this.gw.recent(user, spaceId, Number(page), Number(perPage));
  }

  @Get('pages/trash')
  trash(
    @AuthUser() user: SysObjectUser,
    @Query('spaceId') spaceId: string,
    @Query('page') page = 1,
    @Query('perPage') perPage = 50,
  ) {
    return this.gw.trash(user, spaceId, Number(page), Number(perPage));
  }

  @Post('pages/:pageId/export')
  async exportPage(
    @Param('pageId') pageId: string,
    @Query('format') format: string,
    @Query('includeChildren') includeChildren: string, // 쿼리 파라미터는 무조건 string으로 들어옴
    @AuthUser() user: SysObjectUser,
    @Res() res: FastifyReply,
  ) {
    return this.gw.exportPage(user, {
      pageId,
      format,
      includeChildren: includeChildren === 'true', // 문자열 → boolean 변환
    }, res);
  }

  @Post('spaces/:spaceId/export')
  async exportSpace(
    @Param('spaceId') spaceId: string,
    @Query('format') format: string,
    @Query('includeAttachments') includeAttachments: string, // string → boolean
    @AuthUser() user: SysObjectUser,
    @Res() res: FastifyReply,
  ) {
    return this.gw.exportSpace(user, {
      spaceId,
      format,
      includeAttachments: includeAttachments === 'true',
    }, res);
  }

  @Post('pages/:pageId/contenthtml')
  async contentToHtmlPage(
    @Param('pageId') pageId: string,
    @AuthUser() user: SysObjectUser,
    @Res() res: FastifyReply,
  ) {
    return this.gw.contentToHtmlPage(user, {
      pageId,
    }, res);
  }

  /**
   * 페이지 비밀번호 설정 (SHA-512 + 글로벌 솔트)
   * POST /api/gw/pages/:pageId/password
   * Body: { password: string }
   * 비밀번호를 빈 문자열로 보내면 비밀번호 해제
   */
  @Post('pages/:pageId/password')
  setPagePassword(
    @Param('pageId') pageId: string,
    @Body() body: { password: string },
    @AuthUser() user: SysObjectUser,
  ) {
    // 빈 문자열이면 비밀번호 해제
    if (!body.password || body.password.trim() === '') {
      return this.gw.removePagePassword(user, pageId);
    }
    return this.gw.setPagePassword(user, pageId, body.password);
  }

  ////////////////////////////////////////////// 파일관련 api //////////////////////////////////////////////
  /**
   * 파일 토큰 생성 API
   * 인증된 사용자만 토큰 발급 가능
   * GET /api/gw/files/:fileId/token
   */
  @Get('files/:fileId/token')
  async getFileToken(
    @Param('fileId') fileId: string,
    @AuthUser() user: SysObjectUser,
  ) {
    if (!isValidUUID(fileId)) {
      throw new NotFoundException('Invalid file id');
    }

    // 파일 존재 여부 확인
    const attachment = await this.attachmentRepo.findById(fileId);
    if (!attachment || (!attachment.page_id && !attachment.template_id)) {
      throw new NotFoundException('File not found');
    }

    // 토큰 생성 (userId는 user.user_code 사용)
    const token = this.fileTokenService.generateToken(fileId, user.usercode);

    return {
      fileId,
      fileToken: token,
      fileName: attachment.file_name,
      expiresIn: 7200, // 2시간 (초)
    };
  }

  /**
   * 파일 다운로드 API
   * 사용처:
   * - coviAI 인터렉션
   * - Synap 첨부파일 미리보기
   *
   * fileToken 파라미터가 있으면 토큰 검증, 없으면 기존 방식 (하위 호환)
   * GET /api/gw/files/:fileId?fileToken=xxx
   */
  @Public()
  @Get('files/:fileId')
  async getFile(
    @Res() res: FastifyReply,
    @Param('fileId') fileId: string,
    @Query('fileToken') fileToken?: string,
  ) {
    if (!isValidUUID(fileId)) {
      throw new NotFoundException('Invalid file id');
    }

    const attachment = await this.attachmentRepo.findById(fileId);
    if (
      !attachment || (!attachment.page_id && !attachment.template_id)
    ) {
      throw new NotFoundException();
    }

    // 파일 토큰 필수 검증
    if (!fileToken) {
      throw new ForbiddenException('File token is required');
    }

    // 토큰 검증 (userId 없이 시간만 검증 - 사이냅 서버에서 호출 시 userId 모름)
    const isValid = this.fileTokenService.validateToken(fileId, fileToken);
    if (!isValid) {
      throw new ForbiddenException('Invalid or expired file token');
    }

    try {
      const fileStream = await this.storageService.read(attachment.file_path);
      res.headers({
        'Content-Type': attachment.mime_type,
        'Cache-Control': 'private, max-age=3600',
      });

      if (!inlineFileExtensions.includes(attachment.file_ext)) {
        res.header(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(attachment.file_name)}"`,
        );
      }

      return res.send(fileStream);
    } catch (err) {
      throw new NotFoundException('File not found');
    }
  }
  ////////////////////////////////////////////// 파일관련 api //////////////////////////////////////////////
}
