import { Module } from '@nestjs/common';
import { ZohoController } from './zoho.controller';
import { ZohoService } from './zoho.service';
import { PhoneLookupService } from './phone-lookup.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [ZohoController],
  providers: [ZohoService, PhoneLookupService],
  exports: [ZohoService, PhoneLookupService],
})
export class ZohoModule {}
