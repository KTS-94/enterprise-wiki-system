import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

/**
 * JWT payload에서 workspaceId (회사코드)를 추출하는 데코레이터
 * workspaceId 값은 그룹웨어에서 전달받은 회사코드입니다.
 */
export const AuthCompanyCode = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const workspaceId = request?.user?.workspaceId;

    if (!workspaceId) {
      throw new BadRequestException('Invalid company code (workspaceId)');
    }

    return workspaceId;
  },
);
