import { Module } from '@nestjs/common';
import { FieldMappingsController } from './field-mappings.controller';
import { FieldMappingsService } from './field-mappings.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [FieldMappingsController],
  providers: [FieldMappingsService],
  exports: [FieldMappingsService],
})
export class FieldMappingsModule {}
