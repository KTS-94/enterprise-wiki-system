/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 사용자 설정 관리
 */
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UserService {
  constructor(private userRepo: UserRepo) {}

  /* async findById(userId: string, workspaceId: string) {
    return this.userRepo.findById(userId, workspaceId);
  } */

  async getUserSetting(userId: string, workspaceId: string) {
    return this.userRepo.getSettings(userId, workspaceId);
  }

  async update(
    updateUserDto: UpdateUserDto,
    userId: string,
    workspaceId: string,
  ) {
    const user = await this.userRepo.getByUserCode(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updates = [];
    if (typeof updateUserDto.fullPageWidth !== 'undefined') {
      updates.push(
        this.userRepo.updatePreference(userId, workspaceId, 'full_page_width', updateUserDto.fullPageWidth),
      );
    }

    if (typeof updateUserDto.pageEditMode !== 'undefined') {
      updates.push(
        this.userRepo.updatePreference(userId, workspaceId, 'page_edit_mode', updateUserDto.pageEditMode.toLowerCase()),
      );
    }

    await Promise.all(updates);

    const UserSetting = await this.userRepo.getSettings(userId, workspaceId);

    const isFullPageWidthEnabled = [true, 1, "1", "Y", "y", "true"].includes(UserSetting?.full_page_width as any);

    return {
        ...user,
        lastLoginAt: UserSetting?.last_login_at,
        lastActiveAt: UserSetting?.last_active_at,
        locale: UserSetting?.locale,
        createdAt: UserSetting?.created_at,
        updatedAt: UserSetting?.updated_at,
        role: UserSetting?.role,
        workspaceId: UserSetting?.workspace_id,
        deactivatedAt: UserSetting?.deactivated_at,
        deletedAt: UserSetting?.deleted_at,
        settings: {
          pageEditMode: UserSetting?.page_edit_mode ?? 'edit',
          fullPageWidth: isFullPageWidthEnabled,
        },
    };
  }
}
