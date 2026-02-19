import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * 파일 토큰 서비스
 * 그룹웨어 FileUtil.getFileTokenArray / isValidToken과 호환되는 토큰 생성/검증
 * 토큰 형식: HMAC-SHA256(fileId|userId|timestamp)|timestamp
 * 유효기간: 2시간 (120분)
 */
@Injectable()
export class FileTokenService {
  private readonly secretKey: string;
  private readonly tokenValidityMinutes = 120; // 2시간

  constructor() {
    // 환경변수에서 시크릿 키 로드 (없으면 기본값 사용)
    this.secretKey = process.env.FILE_TOKEN_SECRET || 'your-secret-key-here';
  }

  /**
   * 파일 토큰 생성
   * @param fileId 파일 ID (attachmentId)
   * @param userId 사용자 ID (userCode)
   * @returns 생성된 토큰
   */
  generateToken(fileId: string, userId: string): string {
    const timestamp = this.getCurrentTimestamp();
    const payload = `${fileId}|${userId}|${timestamp}`;
    const signature = this.sign(payload);

    // Base64 인코딩하여 URL-safe 토큰 생성
    const token = Buffer.from(`${signature}|${timestamp}`).toString('base64url');
    return token;
  }

  /**
   * 파일 토큰 검증
   * @param fileId 파일 ID
   * @param token 검증할 토큰
   * @param userId 사용자 ID (선택적 - 없으면 시간만 검증)
   * @param checkTime 시간 검증 여부 (기본 true)
   * @returns 유효한 토큰이면 true
   */
  validateToken(
    fileId: string,
    token: string,
    userId?: string,
    checkTime = true
  ): boolean {
    try {
      if (!fileId || !token) {
        return false;
      }

      // Base64 디코딩
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('|');

      if (parts.length !== 2) {
        return false;
      }

      const [signature, timestamp] = parts;

      // 시간 검증
      if (checkTime) {
        const tokenTime = new Date(timestamp);
        const now = new Date();
        const diffMinutes = (now.getTime() - tokenTime.getTime()) / (1000 * 60);

        if (diffMinutes > this.tokenValidityMinutes || diffMinutes < 0) {
          return false;
        }
      }

      // 서명 검증 (userId가 있으면 포함, 없으면 fileId만으로 검증)
      if (userId) {
        const payload = `${fileId}|${userId}|${timestamp}`;
        const expectedSignature = this.sign(payload);
        return this.safeCompare(signature, expectedSignature);
      } else {
        // userId 없이 검증 - 모든 가능한 userId에 대해 검증 불가
        // 이 경우 서명 형식만 확인
        return signature.length === 64; // SHA256 hex는 64자
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * 현재 타임스탬프 (UTC ISO 형식)
   */
  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * HMAC-SHA256 서명 생성
   */
  private sign(payload: string): string {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
  }

  /**
   * 타이밍 공격 방지를 위한 안전한 문자열 비교
   */
  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
