import { Module } from '@nestjs/common';
import { MetaService } from './meta.service';
import { WebhookController } from './webhook.controller';
import { SyncController } from './sync.controller';

@Module({
  controllers: [WebhookController, SyncController],
  providers: [MetaService],
  exports: [MetaService],
})
export class MetaModule {}
