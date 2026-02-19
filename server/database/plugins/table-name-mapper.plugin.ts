/**
 * Kysely 테이블명 매핑 플러그인
 *
 * 스키마 추가만 수행 (프리픽스 제거됨)
 * 예: wiki_pages -> covi_wiki.wiki_pages (MariaDB)
 *     wiki_pages -> gwuser.wiki_pages (Oracle)
 */
import {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
  OperationNodeTransformer,
  TableNode,
  SchemableIdentifierNode,
} from 'kysely';

export interface TableNameMapperConfig {
  /**
   * Wiki 테이블 스키마 (예: covi_wiki, gwuser)
   * 빈 문자열이면 스키마 없이 사용
   */
  wikiSchema: string;

  /**
   * 그룹웨어 테이블 스키마 (예: covi_smart4j, gwuser)
   */
  gwSchema: string;

  /**
   * Wiki 테이블 목록 (테이블명 그대로)
   */
  wikiTables: string[];

  /**
   * 그룹웨어 테이블 매핑 (논리명 -> 물리명)
   */
  gwTables: Record<string, string>;
}

/**
 * 테이블명을 변환하는 AST Transformer
 */
class TableNameTransformer extends OperationNodeTransformer {
  constructor(private config: TableNameMapperConfig) {
    super();
  }

  protected transformTable(node: TableNode): TableNode {
    const tableIdentifier = node.table;

    // 이미 스키마가 지정된 경우 (예: covi_smart4j.sys_object_user)
    if (tableIdentifier.schema) {
      const oldSchema = tableIdentifier.schema.name;
      const tableName = tableIdentifier.identifier.name;

      // 그룹웨어 테이블 스키마 변환
      if (oldSchema === 'covi_smart4j' || oldSchema === this.config.gwSchema) {
        const newTable = this.config.gwSchema
          ? SchemableIdentifierNode.createWithSchema(this.config.gwSchema, tableName)
          : SchemableIdentifierNode.create(tableName);

        return {
          ...node,
          table: newTable,
        };
      }

      return node;
    }

    const tableName = tableIdentifier.identifier.name;

    // Wiki 테이블: 스키마만 추가 (프리픽스 없음)
    if (this.config.wikiTables.includes(tableName)) {
      const newTable = this.config.wikiSchema
        ? SchemableIdentifierNode.createWithSchema(this.config.wikiSchema, tableName)
        : SchemableIdentifierNode.create(tableName);

      return {
        ...node,
        table: newTable,
      };
    }

    // 그룹웨어 테이블 변환
    if (tableName in this.config.gwTables) {
      const physicalName = this.config.gwTables[tableName];

      const newTable = this.config.gwSchema
        ? SchemableIdentifierNode.createWithSchema(this.config.gwSchema, physicalName)
        : SchemableIdentifierNode.create(physicalName);

      return {
        ...node,
        table: newTable,
      };
    }

    return node;
  }
}

/**
 * 테이블명 매핑 플러그인
 */
export class TableNameMapperPlugin implements KyselyPlugin {
  private transformer: TableNameTransformer;

  constructor(config: TableNameMapperConfig) {
    this.transformer = new TableNameTransformer(config);
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.transformer.transformNode(args.node) as RootOperationNode;
  }

  async transformResult(
    args: PluginTransformResultArgs,
  ): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}

/**
 * Wiki 테이블 목록 (실제 테이블명)
 * db.d.ts의 DB 인터페이스와 일치해야 함
 */
export const WIKI_TABLES = [
  'wiki_attachments',
  'wiki_file_tasks',
  'wiki_page_backlinks',
  'wiki_page_history',
  'wiki_page_share',
  'wiki_pages',
  'wiki_space_members',
  'wiki_spaces',
  'wiki_template_history',
  'wiki_templates',
  'wiki_user_settings',
];

/**
 * 그룹웨어 테이블 매핑 (논리명 -> 물리명)
 */
export const GW_TABLES: Record<string, string> = {
  'sys_object_user': 'sys_object_user',
  'sys_object_user_basegroup': 'sys_object_user_basegroup',
};

/**
 * 플러그인 생성 헬퍼 함수
 */
export function createTableNameMapperPlugin(
  wikiSchema: string,
  gwSchema: string,
): TableNameMapperPlugin {
  return new TableNameMapperPlugin({
    wikiSchema,
    gwSchema,
    wikiTables: WIKI_TABLES,
    gwTables: GW_TABLES,
  });
}
