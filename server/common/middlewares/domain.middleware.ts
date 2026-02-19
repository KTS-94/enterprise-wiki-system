import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtService } from '@nestjs/jwt';
import * as cookie from 'cookie';

@Injectable()
export class DomainMiddleware implements NestMiddleware {
  constructor(
    private jwtService: JwtService,
  ) {}

  async use(
    req: FastifyRequest['raw'],
    res: FastifyReply['raw'],
    next: () => void,
  ) {
    let workspaceId: string | null = null;

    // 1. 쿠키에서 CWAT 토큰 추출
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      try {
        const cookies = cookie.parse(cookieHeader);
        const cwatToken = cookies['CWAT'];

        if (cwatToken) {
          // 2. JWT 토큰 디코드 (검증 없이 payload만 추출)
          try {
            const payload = this.jwtService.decode(cwatToken) as any;
            if (payload?.workspaceId && payload?.type === 'access') {
              workspaceId = payload.workspaceId;
            }
          } catch (err) {
            // 토큰 디코드 실패 시 무시 (만료되었거나 잘못된 토큰)
          }
        }
      } catch (err) {
        // 쿠키 파싱 실패 시 무시
      }
    }

    // 3. workspaceId (회사코드)를 request에 설정
    (req as any).workspaceId = workspaceId;
    next();
  }
}