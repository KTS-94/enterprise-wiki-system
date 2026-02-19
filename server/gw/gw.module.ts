import { Module } from '@nestjs/common';
import { GwController } from './gw.controller';
import { GwService } from './page/services/gw.service';
import { FileTokenService } from './file-token.service';
import { ExportModule } from '../integrations/export/export.module';

// Page 서비스 묶음 (이미 있는 그대로)
import { PageModule } from '../core/page/page.module';
import { CoreModule } from '../core/core.module';

@Module({
  imports: [PageModule, CoreModule, ExportModule],
  controllers: [GwController],
  providers: [GwService, FileTokenService],
  exports: [FileTokenService],
})
export class GwModule {}
