/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 비밀번호 보호 페이지 API, 최근 페이지 조회, 히스토리 관리 확장
 */
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PageService } from './services/page.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { MovePageDto, MovePageToSpaceDto } from './dto/move-page.dto';
import {
  PageHistoryIdDto,
  PageIdDto,
  PageInfoDto,
  DeletePageDto,
  SpaceIdDto,
  SpacePageIndexDto,
} from './dto/page.dto';
import { PageHistoryService } from './services/page-history.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthCompanyCode } from '../../common/decorators/auth-company-code.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { SysObjectUser } from '@docmost/db/types/entity.types';
import { SidebarPageDto } from './dto/sidebar-page.dto';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { RecentPageDto } from './dto/recent-page.dto';
import { DuplicatePageDto } from './dto/duplicate-page.dto';
import { DeletedPageDto } from './dto/deleted-page.dto';
import {
  VerifyPagePasswordDto,
  VerifyPagePasswordResponseDto,
} from './dto/verify-page-password.dto';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PageController {
  constructor(
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly pageHistoryService: PageHistoryService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('/info')
  async getPage(
    @Body() dto: PageInfoDto,
    @AuthUser() user: SysObjectUser,
  ) {
    // 비밀번호 보호 페이지는 content 제외하고 조회
    const pageBasic = await this.pageRepo.findById(dto.pageId, {
      includeSpace: true,
      includeContent: false,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });

    if (!pageBasic) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, pageBasic.space_id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    // 비밀번호 보호 페이지가 아니면 content 포함하여 반환
    if (pageBasic.use_page_password !== 'Y') {
      const pageWithContent = await this.pageRepo.findById(dto.pageId, {
        includeSpace: true,
        includeContent: true,
        includeCreator: true,
        includeLastUpdatedBy: true,
        includeContributors: true,
      });
      return pageWithContent;
    }

    // 비밀번호 보호 페이지는 content 없이 반환 (보안)
    return {
      ...pageBasic,
      content: null,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('/verify-password')
  async verifyPagePassword(
    @Body() dto: VerifyPagePasswordDto,
    @AuthUser() user: SysObjectUser,
  ): Promise<VerifyPagePasswordResponseDto> {
    const page = await this.pageRepo.findById(dto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    // Space 권한 확인
    const ability = await this.spaceAbility.createForUser(user, page.space_id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const verified = await this.pageService.verifyPagePassword(
      dto.pageId,
      dto.password,
    );

    // 검증 성공 시 content 포함하여 반환
    if (verified) {
      const pageWithContent = await this.pageRepo.findById(dto.pageId, {
        includeContent: true,
      });
      return {
        verified: true,
        message: 'Password verified',
        content: pageWithContent?.content || null,
      };
    }

    return {
      verified: false,
      message: 'Invalid password',
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('/viewinfo')
  async getPageViewInfo(
    @Body() dto: PageInfoDto,
    @AuthUser() user: SysObjectUser,
  ) {
    // 비밀번호 보호 페이지는 content 제외하고 조회
    const pageBasic = await this.pageRepo.findById(dto.pageId, {
      includeSpace: true,
      includeContent: false,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });

    if (!pageBasic) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, pageBasic.space_id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    // 비밀번호 보호 페이지가 아니면 content 포함하여 반환
    if (pageBasic.use_page_password !== 'Y') {
      const pageWithContent = await this.pageRepo.findById(dto.pageId, {
        includeSpace: true,
        includeContent: true,
        includeCreator: true,
        includeLastUpdatedBy: true,
        includeContributors: true,
      });
      return pageWithContent;
    }

    // 비밀번호 보호 페이지는 content 없이 반환 (보안)
    return {
      ...pageBasic,
      content: null,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() createPageDto: CreatePageDto,
    @AuthUser() user: SysObjectUser,
    @AuthCompanyCode() workspaceId: string,
  ) {
    const ability = await this.spaceAbility.createForUser(
      user,
      createPageDto.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.pageService.create(user.usercode, workspaceId, createPageDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(@Body() updatePageDto: UpdatePageDto, @AuthUser() user: SysObjectUser) {
    const page = await this.pageRepo.findById(updatePageDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.space_id);
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.pageService.update(page, updatePageDto, user.usercode);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(@Body() deletePageDto: DeletePageDto, @AuthUser() user: SysObjectUser) {
    const page = await this.pageRepo.findById(deletePageDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.space_id);

    if (deletePageDto.permanentlyDelete) {
      // Permanent deletion requires space admin permissions
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
        throw new ForbiddenException(
          'Only space admins can permanently delete pages',
        );
      }
      await this.pageService.forceDelete(deletePageDto.pageId);
    } else {
      // Soft delete requires page manage permissions
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
      await this.pageService.remove(deletePageDto.pageId, user.usercode);
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('restore')
  async restore(@Body() pageIdDto: PageIdDto, @AuthUser() user: SysObjectUser) {
    const page = await this.pageRepo.findById(pageIdDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.space_id);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    await this.pageRepo.restorePage(pageIdDto.pageId);

    // Return the restored page data with hasChildren info
    const restoredPage = await this.pageRepo.findById(pageIdDto.pageId, {
      includeHasChildren: true,
    });
    return restoredPage;
  }

  @HttpCode(HttpStatus.OK)
  @Post('space-index')
  async getSpacePageIndex(
    @Body() dto: SpacePageIndexDto,
    @AuthUser() user: SysObjectUser,
  ) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    return this.pageService.getSpacePageIndex(dto.spaceId, dto.limit);
  }

  @HttpCode(HttpStatus.OK)
  @Post('recent')
  async getRecentPages(
    @Body() recentPageDto: RecentPageDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: SysObjectUser,
  ) {
    if (recentPageDto.spaceId) {
      const ability = await this.spaceAbility.createForUser(
        user,
        recentPageDto.spaceId,
      );

      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      return this.pageService.getRecentSpacePages(
        recentPageDto.spaceId,
        pagination,
      );
    }

    return this.pageService.getRecentPages(user.usercode, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('trash')
  async getDeletedPages(
    @Body() deletedPageDto: DeletedPageDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: SysObjectUser,
  ) {
    if (deletedPageDto.spaceId) {
      const ability = await this.spaceAbility.createForUser(
        user,
        deletedPageDto.spaceId,
      );

      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      return this.pageService.getDeletedSpacePages(
        deletedPageDto.spaceId,
        pagination,
      );
    }
  }

  // TODO: scope to workspaces
  @HttpCode(HttpStatus.OK)
  @Post('/history')
  async getPageHistory(
    @Body() dto: PageIdDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: SysObjectUser,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.space_id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.pageHistoryService.findHistoryByPageId(page.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/history/info')
  async getPageHistoryInfo(
    @Body() dto: PageHistoryIdDto,
    @AuthUser() user: SysObjectUser,
  ) {
    const history = await this.pageHistoryService.findById(dto.historyId);
    if (!history) {
      throw new NotFoundException('Page history not found');
    }

    const ability = await this.spaceAbility.createForUser(
      user,
      history.space_id,
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    return history;
  }

  @HttpCode(HttpStatus.OK)
  @Post('/sidebar-pages')
  async getSidebarPages(
    @Body() dto: SidebarPageDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: SysObjectUser,
  ) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    let pageId = null;
    if (dto.pageId) {
      const page = await this.pageRepo.findById(dto.pageId);
      if (page.space_id !== dto.spaceId) {
        throw new ForbiddenException();
      }
      pageId = page.id;
    }

    return this.pageService.getSidebarPages(dto.spaceId, pagination, pageId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('move-to-space')
  async movePageToSpace(
    @Body() dto: MovePageToSpaceDto,
    @AuthUser() user: SysObjectUser,
  ) {
    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage) {
      throw new NotFoundException('Page to move not found');
    }
    if (movedPage.space_id === dto.spaceId) {
      throw new BadRequestException('Page is already in this space');
    }

    const abilities = await Promise.all([
      this.spaceAbility.createForUser(user, movedPage.space_id),
      this.spaceAbility.createForUser(user, dto.spaceId),
    ]);

    if (
      abilities.some((ability) =>
        ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page),
      )
    ) {
      throw new ForbiddenException();
    }

    return this.pageService.movePageToSpace(movedPage, dto.spaceId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('duplicate')
  async duplicatePage(@Body() dto: DuplicatePageDto, @AuthUser() user: SysObjectUser) {
    const copiedPage = await this.pageRepo.findById(dto.pageId);
    if (!copiedPage) {
      throw new NotFoundException('Page to copy not found');
    }

    // If spaceId is provided, it's a copy to different space
    if (dto.spaceId) {
      const abilities = await Promise.all([
        this.spaceAbility.createForUser(user, copiedPage.space_id),
        this.spaceAbility.createForUser(user, dto.spaceId),
      ]);

      if (
        abilities.some((ability) =>
          ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page),
        )
      ) {
        throw new ForbiddenException();
      }

      return this.pageService.duplicatePage(copiedPage, dto.spaceId, user);
    } else {
      // If no spaceId, it's a duplicate in same space
      const ability = await this.spaceAbility.createForUser(
        user,
        copiedPage.space_id,
      );
      if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      return this.pageService.duplicatePage(copiedPage, undefined, user);
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('move')
  async movePage(@Body() dto: MovePageDto, @AuthUser() user: SysObjectUser) {
    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage) {
      throw new NotFoundException('Moved page not found');
    }

    const ability = await this.spaceAbility.createForUser(
      user,
      movedPage.space_id,
    );
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.pageService.movePage(dto, movedPage);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/breadcrumbs')
  async getPageBreadcrumbs(@Body() dto: PageIdDto, @AuthUser() user: SysObjectUser) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.space_id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    return this.pageService.getPageBreadCrumbs(page.id);
  }
}
