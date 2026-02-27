import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { FieldMappingsModule } from '../field-mappings/field-mappings.module';

@Module({
  imports: [FieldMappingsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
