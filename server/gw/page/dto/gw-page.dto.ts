import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class GwCreatePageDto {
  @IsUUID() spaceId!: string;
  @IsOptional() @IsUUID() parentPageId?: string | null;
  @IsOptional() @IsString() title?: string;
  @IsOptional() icon?: any;
  @IsOptional() content?: any;               // tiptap JSON(옵션)
  @IsOptional() @IsString() idempotencyKey?: string;
}

export class GwUpdatePageDto {
  @IsUUID() pageId!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() icon?: any;
  @IsOptional() content?: any;
}

export class GwMovePageDto {
  @IsUUID() pageId!: string;
  @IsOptional() @IsUUID() parentPageId?: string | null;
  @IsOptional() @IsUUID() beforePageId?: string | null;  // 앞 페이지 ID (이 페이지 뒤에 배치)
  @IsOptional() @IsUUID() afterPageId?: string | null;   // 뒤 페이지 ID (이 페이지 앞에 배치)
  @IsOptional() @IsUUID() spaceId?: string;              // 대상 space (다른 space로 이동 시)
}

export class GwDeletePageDto {
  @IsUUID() pageId!: string;
  @IsOptional() @IsBoolean() permanentlyDelete?: boolean;
}

export class GwDuplicatePageDto {
  @IsUUID() pageId!: string;
  @IsOptional() @IsUUID() spaceId?: string; // 없으면 동일 space
}

export class GwMoveToSpaceDto {
  @IsUUID() pageId!: string;
  @IsUUID() spaceId!: string;
}
