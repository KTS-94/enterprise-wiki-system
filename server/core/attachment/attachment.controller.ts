/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 회사코드 기반 파일 업로드, JWT 토큰 기반 첨부파일 접근
 */
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AttachmentService } from './services/attachment.service';
import { FastifyReply } from 'fastify';
import { FileInterceptor } from '../../common/interceptors/file.interceptor';
import * as bytes from 'bytes';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthCompanyCode } from '../../common/decorators/auth-company-code.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SysObjectUser } from '@docmost/db/types/entity.types';
import { StorageService } from '../../integrations/storage/storage.service';
import {
  getAttachmentFolderPath,
  validAttachmentTypes,
} from './attachment.utils';
import { getMimeType } from '../../common/helpers';
import {
  AttachmentType,
  inlineFileExtensions,
  MAX_AVATAR_SIZE,
} from './attachment.constants';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { TemplateRepo } from '@docmost/db/repos/template/template.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { validate as isValidUUID } from 'uuid';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { TokenService } from '../auth/services/token.service';
import { JwtAttachmentPayload, JwtType } from '../auth/dto/jwt-payload';
import * as path from 'path';

@Controller()
export class AttachmentController {
  private readonly logger = new Logger(AttachmentController.name);

  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly storageService: StorageService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageRepo: PageRepo,
    private readonly templateRepo: TemplateRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly environmentService: EnvironmentService,
    private readonly tokenService: TokenService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('files/upload')
  @UseInterceptors(FileInterceptor)
  async uploadFile(
    @Req() req: any,
    @AuthUser() user: SysObjectUser,
    @AuthCompanyCode() workspaceId: string,
  ) {
    const maxFileSize = bytes(this.environmentService.getFileUploadSizeLimit());

    let file = null;
    try {
      file = await req.file({
        limits: { fileSize: maxFileSize, fields: 3, files: 1 },
      });
    } catch (err: any) {
      this.logger.error(err.message);
      if (err?.statusCode === 413) {
        throw new BadRequestException(
          `File too large. Exceeds the ${this.environmentService.getFileUploadSizeLimit()} limit`,
        );
      }
    }

    if (!file) {
      throw new BadRequestException('Failed to upload file');
    }

    const pageId = file.fields?.pageId?.value;
    const templateId = file.fields?.templateId?.value;

    if (!pageId && !templateId) {
      throw new BadRequestException('Either pageId or templateId is required');
    }
    if (pageId && templateId) {
      throw new BadRequestException('Cannot specify both pageId and templateId');
    }

    let spaceId: string;
    
    if (pageId) {
      const page = await this.pageRepo.findById(pageId);

      if (!page) {
        throw new NotFoundException('Page not found');
      }

      const spaceAbility = await this.spaceAbility.createForUser(
        user,
        page.space_id,
      );
      if (spaceAbility.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      spaceId = page.space_id;
    } else {
      const template = await this.templateRepo.findById(templateId);
      
      /* if (!template) {
        throw new NotFoundException('Template not found');
      } */

      // draft template의 경우 spaceId가 null일 수 있음
      spaceId = template?.space_id ?? null;
    }

    const attachmentId = file.fields?.attachmentId?.value;
    if (attachmentId && !isValidUUID(attachmentId)) {
      throw new BadRequestException('Invalid attachment id');
    }

    try {
      const fileResponse = await this.attachmentService.uploadFile({
        filePromise: file,
        pageId: pageId,
        templateId: templateId,
        spaceId: spaceId,
        userId: user.usercode,
        workspaceId: workspaceId,
        attachmentId: attachmentId,
      });

      return fileResponse;
    } catch (err: any) {
      if (err?.statusCode === 413) {
        const errMessage = `File too large. Exceeds the ${this.environmentService.getFileUploadSizeLimit()} limit`;
        this.logger.error(errMessage);
        throw new BadRequestException(errMessage);
      }
      this.logger.error(err);
      throw new BadRequestException('Error processing file upload.');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('/files/:fileId/:fileName')
  async getFile(
    @Res() res: FastifyReply,
    @AuthUser() user: SysObjectUser,
    @AuthCompanyCode() workspaceId: string,
    @Param('fileId') fileId: string,
    @Param('fileName') fileName?: string,
  ) {
    if (!isValidUUID(fileId)) {
      throw new NotFoundException('Invalid file id');
    }

    const attachment = await this.attachmentRepo.findById(fileId);
    if (
      !attachment ||
      attachment.workspace_id !== workspaceId ||
      (!attachment.page_id && !attachment.template_id)
    ) {
      throw new NotFoundException();
    }

    // pageId가 있으면 page 권한 체크, templateId가 있으면 template 권한 체크
    if (attachment.page_id) {
      if (!attachment.space_id) {
        throw new NotFoundException();
      }
      const spaceAbility = await this.spaceAbility.createForUser(
        user,
        attachment.space_id,
      );
      if (spaceAbility.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    } else if (attachment.template_id) {
      // templateId가 있으면 템플릿이 존재하는지 확인
      const template = await this.templateRepo.findById(attachment.template_id);
      /* if (!template) {
        throw new NotFoundException('Template not found');
      } */
      // 템플릿은 workspace 내의 모든 사용자가 접근 가능하다고 가정

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
      this.logger.error(err);
      throw new NotFoundException('File not found');
    }
  }

  @Get('/files/public/:fileId/:fileName')
  async getPublicFile(
    @Res() res: FastifyReply,
    @AuthCompanyCode() workspaceId: string,
    @Param('fileId') fileId: string,
    @Param('fileName') fileName?: string,
    @Query('jwt') jwtToken?: string,
  ) {
    let jwtPayload: JwtAttachmentPayload = null;
    try {
      jwtPayload = await this.tokenService.verifyJwt(
        jwtToken,
        JwtType.ATTACHMENT,
      );
    } catch (err) {
      throw new BadRequestException(
        'Expired or invalid attachment access token',
      );
    }

    if (
      !isValidUUID(fileId) ||
      fileId !== jwtPayload.attachmentId
      //|| jwtPayload.workspaceId !== workspaceId // 워크스페이스 ID가 토큰에 있는 값과 실제 요청의 워크스페이스가 일치하는지 검증
    ) {
      throw new NotFoundException('File not found');
    }

    const attachment = await this.attachmentRepo.findById(fileId);
    if (
      !attachment ||
      attachment.workspace_id !== workspaceId ||
      !attachment.page_id ||
      !attachment.space_id ||
      jwtPayload.pageId !== attachment.page_id
    ) {
      throw new NotFoundException('File not found');
    }

    try {
      const fileStream = await this.storageService.read(attachment.file_path);
      res.headers({
        'Content-Type': attachment.mime_type,
        'Cache-Control': 'public, max-age=3600',
      });

      if (!inlineFileExtensions.includes(attachment.file_ext)) {
        res.header(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(attachment.file_name)}"`,
        );
      }

      return res.send(fileStream);
    } catch (err) {
      this.logger.error(err);
      throw new NotFoundException('File not found');
    }
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('attachments/upload-image')
  @UseInterceptors(FileInterceptor)
  async uploadAvatarOrLogo(
    @Req() req: any,
    @Res() res: FastifyReply,
    @AuthUser() user: SysObjectUser,
    @AuthCompanyCode() workspaceId: string,
  ) {
    const maxFileSize = bytes(MAX_AVATAR_SIZE);

    let file = null;
    try {
      file = await req.file({
        limits: { fileSize: maxFileSize, fields: 3, files: 1 },
      });
    } catch (err: any) {
      if (err?.statusCode === 413) {
        throw new BadRequestException(
          `File too large. Exceeds the ${MAX_AVATAR_SIZE} limit`,
        );
      }
    }

    if (!file) {
      throw new BadRequestException('Invalid file upload');
    }

    const attachmentType = file.fields?.type?.value;
    const spaceId = file.fields?.spaceId?.value;

    if (!attachmentType) {
      throw new BadRequestException('attachment type is required');
    }

    if (
      !validAttachmentTypes.includes(attachmentType) ||
      attachmentType === AttachmentType.File
    ) {
      throw new BadRequestException('Invalid image attachment type');
    }

    // WorkspaceLogo 업로드는 인증된 사용자만 허용 (workspace 권한 체크 제거)

    if (attachmentType === AttachmentType.SpaceLogo) {
      if (!spaceId) {
        throw new BadRequestException('spaceId is required');
      }

      const spaceAbility = await this.spaceAbility.createForUser(user, spaceId);
      if (
        spaceAbility.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)
      ) {
        throw new ForbiddenException();
      }
    }

    /* try {
      const fileResponse = await this.attachmentService.uploadImage(
        file,
        attachmentType,
        user.usercode,
        workspaceId,
        spaceId,
      );

      return res.send(fileResponse);
    } catch (err: any) {
      this.logger.error(err);
      throw new BadRequestException('Error processing file upload.');
    } */
  }

  @Get('attachments/img/:attachmentType/:fileName')
  async getLogoOrAvatar(
    @Res() res: FastifyReply,
    @AuthCompanyCode() workspaceId: string,
    @Param('attachmentType') attachmentType: AttachmentType,
    @Param('fileName') fileName?: string,
  ) {
    if (
      !validAttachmentTypes.includes(attachmentType) ||
      attachmentType === AttachmentType.File
    ) {
      throw new BadRequestException('Invalid image attachment type');
    }

    const filenameWithoutExt = path.basename(fileName, path.extname(fileName));
    if (!isValidUUID(filenameWithoutExt)) {
      throw new BadRequestException('Invalid file id');
    }

    const filePath = `${getAttachmentFolderPath(attachmentType, workspaceId)}/${fileName}`;

    try {
      const fileStream = await this.storageService.read(filePath);
      res.headers({
        'Content-Type': getMimeType(filePath),
        'Cache-Control': 'private, max-age=86400',
      });
      return res.send(fileStream);
    } catch (err) {
      this.logger.error(err);
      throw new NotFoundException('File not found');
    }
  }
}
