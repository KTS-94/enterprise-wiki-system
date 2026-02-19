/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 그룹웨어 파일 관리 연동
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StorageService } from '../../../integrations/storage/storage.service';
import { MultipartFile } from '@fastify/multipart';
import {
  getAttachmentFolderPath,
  PreparedFile,
  prepareFile,
} from '../attachment.utils';
import { v7 as uuid7 } from 'uuid';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { AttachmentType } from '../attachment.constants';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { Attachment } from '@docmost/db/types/entity.types';
import { InjectKysely } from 'nestjs-kysely';
@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);
  constructor(
    private readonly storageService: StorageService,
    private readonly attachmentRepo: AttachmentRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async uploadFile(opts: {
    filePromise: Promise<MultipartFile>;
    pageId?: string;
    templateId?: string;
    userId: string;
    spaceId: string | null;  // null 허용
    workspaceId: string;
    attachmentId?: string;
  }) {
    const { filePromise, pageId, templateId, spaceId, userId, workspaceId } = opts;

    // pageId와 templateId 중 하나는 반드시 있어야 함
    if (!pageId && !templateId) {
      throw new BadRequestException('Either pageId or templateId is required');
    }
    if (pageId && templateId) {
      throw new BadRequestException('Cannot specify both pageId and templateId');
    }
    const preparedFile: PreparedFile = await prepareFile(filePromise);

    let isUpdate = false;
    let attachmentId = null;

    // passing attachmentId to allow for updating diagrams
    // instead of creating new files for each save
    if (opts?.attachmentId) {
      const existingAttachment = await this.attachmentRepo.findById(
        opts.attachmentId,
      );
      if (!existingAttachment) {
        throw new NotFoundException(
          'Existing attachment to overwrite not found',
        );
      }

      const attachmentPageId = existingAttachment.page_id;
      const attachmentTemplateId = existingAttachment.template_id;

      if (
        (pageId && attachmentPageId !== pageId) ||
        (templateId && attachmentTemplateId !== templateId) ||
        existingAttachment.file_ext !== preparedFile.fileExtension ||
        existingAttachment.workspace_id !== workspaceId
      ) {
        throw new BadRequestException('File attachment does not match');
      }
      attachmentId = opts.attachmentId;
      isUpdate = true;
    } else {
      attachmentId = uuid7();
    }

    const filePath = `${getAttachmentFolderPath(AttachmentType.File, workspaceId)}/${attachmentId}/${preparedFile.fileName}`;

    await this.uploadToDrive(filePath, preparedFile.buffer);

    let attachment: Attachment = null;
    try {
      if (isUpdate) {
        attachment = await this.attachmentRepo.updateAttachment(
          {
            updated_at: new Date(),
          },
          attachmentId,
        );
      } else {
        attachment = await this.saveAttachment({
          attachmentId,
          preparedFile,
          filePath,
          type: AttachmentType.File,
          userId,
          spaceId,
          workspaceId,
          pageId,
          templateId,
        });
      }
    } catch (err) {
      // delete uploaded file on error
      this.logger.error(err);
    }

    return attachment;
  }

  async deleteRedundantFile(filePath: string) {
    try {
      await this.storageService.delete(filePath);
      await this.attachmentRepo.deleteAttachmentByFilePath(filePath);
    } catch (error) {
      this.logger.error('deleteRedundantFile', error);
    }
  }

  async uploadToDrive(filePath: string, fileBuffer: any) {
    try {
      await this.storageService.upload(filePath, fileBuffer);
    } catch (err) {
      this.logger.error('Error uploading file to drive:', err);
      throw new BadRequestException('Error uploading file to drive');
    }
  }

  async saveAttachment(opts: {
    attachmentId?: string;
    preparedFile: PreparedFile;
    filePath: string;
    type: AttachmentType;
    userId: string;
    workspaceId: string;
    pageId?: string;
    templateId?: string;
    spaceId?: string;
    trx?: KyselyTransaction;
  }): Promise<Attachment> {
    const {
      attachmentId,
      preparedFile,
      filePath,
      type,
      userId,
      workspaceId,
      pageId,
      templateId,
      spaceId,
      trx,
    } = opts;
    return this.attachmentRepo.insertAttachment(
      {
        id: attachmentId,
        type: type,
        file_path: filePath,
        file_name: preparedFile.fileName,
        file_size: preparedFile.fileSize,
        mime_type: preparedFile.mimeType,
        file_ext: preparedFile.fileExtension,
        creator_id: userId,
        workspace_id: workspaceId,
        page_id: pageId,
        template_id: templateId,
        space_id: spaceId,
      },
      trx,
    );
  }

  async handleDeleteSpaceAttachments(spaceId: string) {
    try {
      const attachments = await this.attachmentRepo.findBySpaceId(spaceId);
      if (!attachments || attachments.length === 0) {
        return;
      }

      const failedDeletions = [];

      await Promise.all(
        attachments.map(async (attachment) => {
          try {
            await this.storageService.delete(attachment.file_path);
            await this.attachmentRepo.deleteAttachmentById(attachment.id);
          } catch (err) {
            failedDeletions.push(attachment.id);
            this.logger.log(
              `DeleteSpaceAttachments: failed to delete attachment ${attachment.id}:`,
              err,
            );
          }
        }),
      );

      if (failedDeletions.length === attachments.length) {
        throw new Error(
          `Failed to delete any attachments for spaceId: ${spaceId}`,
        );
      }
    } catch (err) {
      throw err;
    }
  }

  async handleDeleteUserAvatars(userId: string) {
    try {
      const userAvatars = await this.db
        .selectFrom('wiki_attachments')
        .select(['id', 'file_path'])
        .where('creator_id', '=', userId)
        .where('type', '=', AttachmentType.Avatar)
        .execute();

      if (!userAvatars || userAvatars.length === 0) {
        return;
      }

      await Promise.all(
        userAvatars.map(async (attachment) => {
          try {
            await this.storageService.delete(attachment.file_path);
            await this.attachmentRepo.deleteAttachmentById(attachment.id);
          } catch (err) {
            this.logger.log(
              `DeleteUserAvatar: failed to delete user avatar ${attachment.id}:`,
              err,
            );
          }
        }),
      );
    } catch (err) {
      throw err;
    }
  }

  async handleDeletePageAttachments(pageId: string) {
    try {
      // Fetch attachments for this page from database
      const attachments = await this.db
        .selectFrom('wiki_attachments')
        .select(['id', 'file_path'])
        .where('page_id', '=', pageId)
        .execute();

      if (!attachments || attachments.length === 0) {
        return;
      }

      const failedDeletions = [];

      await Promise.all(
        attachments.map(async (attachment) => {
          try {
            // Delete from storage
            await this.storageService.delete(attachment.file_path);
            // Delete from database
            await this.attachmentRepo.deleteAttachmentById(attachment.id);
          } catch (err) {
            failedDeletions.push(attachment.id);
            this.logger.error(
              `Failed to delete attachment ${attachment.id} for page ${pageId}:`,
              err,
            );
          }
        }),
      );

      if (failedDeletions.length > 0) {
        this.logger.warn(
          `Failed to delete ${failedDeletions.length} attachments for page ${pageId}`,
        );
      }
    } catch (err) {
      throw err;
    }
  }

  async handleDeleteTemplateAttachments(templateId: string) {
    try {
      // Fetch attachments for this template from database
      const attachments = await this.db
        .selectFrom('wiki_attachments')
        .select(['id', 'file_path'])
        .where('template_id', '=', templateId)
        .execute();

      if (!attachments || attachments.length === 0) {
        return;
      }

      const failedDeletions = [];

      await Promise.all(
        attachments.map(async (attachment) => {
          try {
            // Delete from storage
            await this.storageService.delete(attachment.file_path);
            // Delete from database
            await this.attachmentRepo.deleteAttachmentById(attachment.id);
          } catch (err) {
            failedDeletions.push(attachment.id);
            this.logger.error(
              `Failed to delete attachment ${attachment.id} for template ${templateId}:`,
              err,
            );
          }
        }),
      );

      if (failedDeletions.length > 0) {
        this.logger.warn(
          `Failed to delete ${failedDeletions.length} attachments for template ${templateId}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Error in handleDeletePageAttachments for page ${templateId}:`,
        err,
      );
      throw err;
    }
  }

  async getAttachmentById(attachmentId: string) {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment) {
      throw new NotFoundException(`Attachment not found: ${attachmentId}`);
    }
    return attachment;
  }
}
