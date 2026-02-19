/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 협업 토큰 인증, 스페이스 역할 검증
 */
import { Extension, onAuthenticatePayload } from '@hocuspocus/server';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../core/auth/services/token.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceRole } from '../../common/helpers/types/permission';
import { getPageId } from '../collaboration.util';
import { JwtCollabPayload, JwtType } from '../../core/auth/dto/jwt-payload';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';

@Injectable()
export class AuthenticationExtension implements Extension {
  private readonly logger = new Logger(AuthenticationExtension.name);

  constructor(
    private tokenService: TokenService,
    private pageRepo: PageRepo,
    private userRepo: UserRepo,
    private spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async onAuthenticate(data: onAuthenticatePayload) {
    const { documentName, token } = data;
    const pageId = getPageId(documentName);

    let jwtPayload: JwtCollabPayload;

    try {
      jwtPayload = await this.tokenService.verifyJwt(token, JwtType.COLLAB);
    } catch (error) {
      throw new UnauthorizedException('Invalid collab token');
    }

    const userId = jwtPayload.sub;

    const user = await this.userRepo.getByUserCode(userId);

    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.isuse !== "Y") {
      throw new UnauthorizedException();
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page) {
      this.logger.warn(`Page not found: ${pageId}`);
      throw new NotFoundException('Page not found');
    }

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.usercode,
      page.space_id,
    );

    let userSpaceRole = findHighestUserSpaceRole(userSpaceRoles);

    // space 정보 미리 조회 (open 여부와 공유 fallback에 필요)
    const space = await this.spaceRepo.getVisibilityByIdOrSlug(page.space_id);
    if (!space || space.deleted_at) {
      this.logger.warn(`Space not found or deleted: ${page.space_id}`);
      throw new UnauthorizedException();
    }

    if (!userSpaceRole) {
      // 그룹웨어 관리자(isAdmin 또는 isEasyAdmin) 체크
      // JWT의 workspaceId가 회사코드(gwDomain)
      const gwDomain = jwtPayload.workspaceId;
      if (gwDomain) {
        const isGwAdmin = await this.userRepo.isGwAdminOrEasyAdmin(user.usercode, gwDomain);
        if (isGwAdmin) {
          userSpaceRole = SpaceRole.ADMIN;
          this.logger.debug(`GW admin granted full access to page: ${pageId}`);
        }
      }

      if (!userSpaceRole) {
        // 공유 권한 fallback
        const sharedRole = await this.spaceMemberRepo.getPageShareRoleInSpace(user.usercode, page.space_id);

        if (sharedRole) {
          userSpaceRole = sharedRole;
        } else if (space.visibility === 'open') {
          // 공개 공간 → writer로 처리
          userSpaceRole = SpaceRole.WRITER;
        } else {
          this.logger.warn(`User not authorized to access page: ${pageId}`);
          throw new UnauthorizedException();
        }
      }
    }

    if (userSpaceRole === SpaceRole.READER) {
      data.connection.readOnly = true;
      this.logger.debug(`User granted readonly access to page: ${pageId}`);
    }

    this.logger.debug(`Authenticated user ${user.usercode} on page ${pageId}`);

    return { user };
  }
}
