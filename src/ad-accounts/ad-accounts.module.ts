import { Module } from '@nestjs/common';
import { AdAccountsController } from './ad-accounts.controller';
import { AdAccountsService } from './ad-accounts.service';

@Module({
  controllers: [AdAccountsController],
  providers: [AdAccountsService],
})
export class AdAccountsModule {}
