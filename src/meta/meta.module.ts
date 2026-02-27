import { Module } from '@nestjs/common';
import { MetaService } from './meta.service';
import { WebhookController } from './webhook.controller';
import { SyncController } from './sync.controller';
import { FieldMappingsModule } from '../field-mappings/field-mappings.module';

@Module({
  imports: [FieldMappingsModule],
  controllers: [WebhookController, SyncController],
  providers: [MetaService],
  exports: [MetaService],
})
export class MetaModule {}
