/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 그룹웨어 관리자(isGwAdmin) 감지, 회사코드 기반 권한
 */
import { Injectable, NotFoundException, Inject, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
} from '@casl/ability';
import { SpaceRole } from '../../../common/helpers/types/permission';
import { SysObjectUser } from '@docmost/db/types/entity.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import {
  SpaceCaslAction,
  ISpaceAbility,
  SpaceCaslSubject,
} from '../interfaces/space-ability.type';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { FastifyRequest } from 'fastify';

@Injectable({ scope: Scope.REQUEST })
export default class SpaceAbilityFactory {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly userRepo: UserRepo,
    @Inject(REQUEST) private readonly request: FastifyRequest,
  ) {}

  private getCompanyCode(): string | undefined {
    // jwt.strategy.ts에서 { user, workspaceId }를 반환하므로 workspaceId가 회사코드
    return (this.request as any)?.user?.workspaceId;
  }

  async createForUser(user: SysObjectUser, spaceId: string, companyCode?: string) {
    // companyCode가 전달되지 않으면 request에서 가져옴
    const resolvedCompanyCode = companyCode ?? this.getCompanyCode();

    // 그룹웨어 관리자(isAdmin 또는 isEasyAdmin)인 경우 전체 권한 부여
    if (resolvedCompanyCode) {
      const isGwAdmin = await this.userRepo.isGwAdminOrEasyAdmin(user.usercode, resolvedCompanyCode);
      if (isGwAdmin) {
        return buildSpaceAdminAbility();
      }
    }

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.usercode,
      spaceId,
    );

    const userSpaceRole = findHighestUserSpaceRole(userSpaceRoles);

    switch (userSpaceRole) {
      case SpaceRole.ADMIN:
        return buildSpaceAdminAbility();
      case SpaceRole.WRITER:
        return buildSpaceWriterAbility();
      case SpaceRole.READER:
        return buildSpaceReaderAbility();
    }

    // 공개(visibility=open) 공간은 읽기+쓰기 허용
    if (await this.spaceRepo.isOpen(spaceId)) {
      return buildSpaceWriterAbility();
    }

    // 공유 권한
    const sharedRole = await this.spaceMemberRepo.getPageShareRoleInSpace(user.usercode, spaceId);
    switch (sharedRole) {
      case SpaceRole.ADMIN:
        return buildSpaceAdminAbility();
      case SpaceRole.WRITER:
        return buildSpaceWriterAbility();
      case SpaceRole.READER:
        return buildSpaceReaderAbility();
    }

    throw new NotFoundException('Space permissions not found');
  }
}

function buildSpaceAdminAbility() {
  const { can, build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(
    createMongoAbility,
  );
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings);
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Member);
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Page);
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Share);
  return build();
}

function buildSpaceWriterAbility() {
  const { can, build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(
    createMongoAbility,
  );
  can(SpaceCaslAction.Read, SpaceCaslSubject.Settings);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Member);
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Page);
  can(SpaceCaslAction.Manage, SpaceCaslSubject.Share);
  return build();
}

function buildSpaceReaderAbility() {
  const { can, build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(
    createMongoAbility,
  );
  can(SpaceCaslAction.Read, SpaceCaslSubject.Settings);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Member);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Page);
  can(SpaceCaslAction.Read, SpaceCaslSubject.Share);
  return build();
}
